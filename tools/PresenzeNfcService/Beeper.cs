using System;
using System.IO;
using System.Runtime.InteropServices;

namespace PresenzeNfcService
{
    /// <summary>
    /// Genera segnali acustici per il feedback delle timbrature NFC.
    ///
    /// Strategia: i WAV vengono sintetizzati in memoria (sinusoidi PCM 16-bit
    /// mono 22050 Hz) UNA volta sola allo startup, poi riprodotti via
    /// PlaySound(SND_MEMORY|SND_ASYNC). Niente file su disco, niente embedded
    /// resources. Se PlaySound fallisce (es. nessuna scheda audio), fallback su
    /// Console.Beep(freq, ms) con frequenze diverse per evento.
    ///
    /// Nota: PlaySound da un Windows Service in Session 0 funziona se c'e' una
    /// scheda audio attiva e gli altoparlanti sono accesi. Sui PC moderni il
    /// "PC speaker" hardware non c'e' piu' e Console.Beep e' silenzioso —
    /// quindi PlaySound e' la strada principale, Console.Beep e' solo dignita'.
    /// </summary>
    public static class Beeper
    {
        public enum Sound
        {
            Entry,
            Exit,
            Pause,
            Unknown,
            Error
        }

        // ── P/Invoke winmm.dll ───────────────────────────────────────────

        [Flags]
        private enum SoundFlags : uint
        {
            SND_SYNC = 0x0000,
            SND_ASYNC = 0x0001,
            SND_NODEFAULT = 0x0002,
            SND_MEMORY = 0x0004,
            SND_NOSTOP = 0x0010,
            SND_PURGE = 0x0040,
            SND_FILENAME = 0x00020000
        }

        [DllImport("winmm.dll", SetLastError = true)]
        private static extern bool PlaySound(byte[] data, IntPtr hMod, SoundFlags flags);

        // ── Cache WAV in memoria ─────────────────────────────────────────

        private static byte[] _entry;
        private static byte[] _exit;
        private static byte[] _pause;
        private static byte[] _unknown;
        private static byte[] _error;

        public static void Init()
        {
            // Tono ENTRY: 2 toni ascendenti (do=523, mi=659)
            _entry = BuildWav(new ToneSpec[] {
                new ToneSpec(523, 130),
                new ToneSpec(0, 30),
                new ToneSpec(659, 180)
            });
            // Tono EXIT: 2 toni discendenti (mi, do)
            _exit = BuildWav(new ToneSpec[] {
                new ToneSpec(659, 130),
                new ToneSpec(0, 30),
                new ToneSpec(523, 180)
            });
            // Tono PAUSE: 1 tono medio singolo
            _pause = BuildWav(new ToneSpec[] {
                new ToneSpec(587, 200)
            });
            // Tono UNKNOWN: 3 beep medi
            _unknown = BuildWav(new ToneSpec[] {
                new ToneSpec(440, 100),
                new ToneSpec(0, 50),
                new ToneSpec(440, 100),
                new ToneSpec(0, 50),
                new ToneSpec(440, 100)
            });
            // Tono ERROR: buzz basso lungo
            _error = BuildWav(new ToneSpec[] {
                new ToneSpec(220, 500)
            });
        }

        public static void Play(Sound sound)
        {
            byte[] data = null;
            int fallbackFreq = 800;
            int fallbackMs = 200;

            switch (sound)
            {
                case Sound.Entry:
                    data = _entry; fallbackFreq = 600; fallbackMs = 200;
                    break;
                case Sound.Exit:
                    data = _exit; fallbackFreq = 500; fallbackMs = 200;
                    break;
                case Sound.Pause:
                    data = _pause; fallbackFreq = 700; fallbackMs = 150;
                    break;
                case Sound.Unknown:
                    data = _unknown; fallbackFreq = 400; fallbackMs = 100;
                    break;
                case Sound.Error:
                    data = _error; fallbackFreq = 220; fallbackMs = 500;
                    break;
            }

            bool ok = false;
            if (data != null)
            {
                try
                {
                    ok = PlaySound(data, IntPtr.Zero, SoundFlags.SND_MEMORY | SoundFlags.SND_ASYNC | SoundFlags.SND_NODEFAULT);
                }
                catch (Exception ex)
                {
                    Logger.Warn("PlaySound exception: " + ex.Message);
                }
            }

            if (!ok)
            {
                // Fallback PC speaker (probabilmente silenzioso su HW moderno)
                try { Console.Beep(fallbackFreq, fallbackMs); }
                catch { /* su Windows Service Console.Beep puo' lanciare HostProtectionException */ }
            }
        }

        // ── Sintesi WAV PCM ──────────────────────────────────────────────

        private struct ToneSpec
        {
            public int Frequency; // Hz; 0 = silenzio
            public int DurationMs;
            public ToneSpec(int freq, int ms) { Frequency = freq; DurationMs = ms; }
        }

        private const int SAMPLE_RATE = 22050;
        private const short BITS_PER_SAMPLE = 16;
        private const short CHANNELS = 1;
        private const double VOLUME = 0.6; // 0.0 .. 1.0

        private static byte[] BuildWav(ToneSpec[] tones)
        {
            // 1. Calcola sample totali
            int totalSamples = 0;
            for (int i = 0; i < tones.Length; i++)
                totalSamples += (SAMPLE_RATE * tones[i].DurationMs) / 1000;

            int dataBytes = totalSamples * (BITS_PER_SAMPLE / 8) * CHANNELS;
            int fileSize = 44 + dataBytes;

            using (MemoryStream ms = new MemoryStream(fileSize))
            using (BinaryWriter w = new BinaryWriter(ms))
            {
                // RIFF header
                w.Write(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' });
                w.Write((int)(fileSize - 8));
                w.Write(new byte[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E' });

                // fmt chunk
                w.Write(new byte[] { (byte)'f', (byte)'m', (byte)'t', (byte)' ' });
                w.Write((int)16);                       // chunk size
                w.Write((short)1);                      // PCM
                w.Write((short)CHANNELS);
                w.Write((int)SAMPLE_RATE);
                w.Write((int)(SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8)); // byte rate
                w.Write((short)(CHANNELS * BITS_PER_SAMPLE / 8));             // block align
                w.Write((short)BITS_PER_SAMPLE);

                // data chunk
                w.Write(new byte[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' });
                w.Write((int)dataBytes);

                short maxAmp = (short)(short.MaxValue * VOLUME);
                int writtenSamples = 0;
                for (int t = 0; t < tones.Length; t++)
                {
                    int samples = (SAMPLE_RATE * tones[t].DurationMs) / 1000;
                    if (tones[t].Frequency <= 0)
                    {
                        // silenzio
                        for (int s = 0; s < samples; s++) w.Write((short)0);
                    }
                    else
                    {
                        double freq = tones[t].Frequency;
                        // fade in/out 5ms per evitare click
                        int fadeSamples = Math.Min(samples / 4, (SAMPLE_RATE * 5) / 1000);
                        for (int s = 0; s < samples; s++)
                        {
                            double phase = 2.0 * Math.PI * freq * s / SAMPLE_RATE;
                            double sample = Math.Sin(phase);
                            double envelope = 1.0;
                            if (s < fadeSamples)
                                envelope = (double)s / fadeSamples;
                            else if (s > samples - fadeSamples)
                                envelope = (double)(samples - s) / fadeSamples;
                            short pcm = (short)(sample * maxAmp * envelope);
                            w.Write(pcm);
                        }
                    }
                    writtenSamples += samples;
                }

                w.Flush();
                return ms.ToArray();
            }
        }
    }
}
