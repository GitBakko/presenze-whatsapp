using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PresenzeNfcService
{
    /// <summary>
    /// Wrapper minimale su WinSCard.dll (PC/SC) per leggere l'UID di una
    /// tessera contactless tramite il lettore bit4id miniLector AIR 3 (o
    /// qualsiasi altro lettore CCID PC/SC).
    ///
    /// Il loop di polling chiama Wait*ForCard, legge l'UID via APDU
    /// "FF CA 00 00 00", invoca il callback, poi attende che la tessera venga
    /// rimossa prima di accettare la lettura successiva. Il loop e' cancellabile
    /// via CancellationToken-style flag (.NET 3.5 non ha CancellationToken).
    ///
    /// L'APDU FF CA 00 00 00 e' lo standard PC/SC "GET DATA" del PC/SC
    /// Workgroup, supportato dal driver bit4id e dalla maggior parte dei
    /// lettori CCID per le tessere ISO 14443 (CIE, CNS, Mifare).
    /// </summary>
    public class PcscReader : IDisposable
    {
        // ── Costanti WinSCard ────────────────────────────────────────────

        private const uint SCARD_SCOPE_USER = 0;
        private const uint SCARD_SCOPE_SYSTEM = 2;

        private const uint SCARD_SHARE_SHARED = 2;
        private const uint SCARD_SHARE_EXCLUSIVE = 1;

        private const uint SCARD_PROTOCOL_T0 = 1;
        private const uint SCARD_PROTOCOL_T1 = 2;
        private const uint SCARD_PROTOCOL_ANY = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;

        private const uint SCARD_LEAVE_CARD = 0;
        private const uint SCARD_RESET_CARD = 1;
        private const uint SCARD_UNPOWER_CARD = 2;

        private const uint SCARD_STATE_UNAWARE = 0x00000000;
        private const uint SCARD_STATE_IGNORE = 0x00000001;
        private const uint SCARD_STATE_CHANGED = 0x00000002;
        private const uint SCARD_STATE_UNKNOWN = 0x00000004;
        private const uint SCARD_STATE_UNAVAILABLE = 0x00000008;
        private const uint SCARD_STATE_EMPTY = 0x00000010;
        private const uint SCARD_STATE_PRESENT = 0x00000020;
        private const uint SCARD_STATE_ATRMATCH = 0x00000040;
        private const uint SCARD_STATE_EXCLUSIVE = 0x00000080;
        private const uint SCARD_STATE_INUSE = 0x00000100;
        private const uint SCARD_STATE_MUTE = 0x00000200;

        private const uint INFINITE = 0xFFFFFFFF;

        // PC/SC return codes (selezione)
        private const uint SCARD_S_SUCCESS = 0x00000000;
        private const uint SCARD_E_TIMEOUT = 0x8010000A;
        private const uint SCARD_E_NO_READERS_AVAILABLE = 0x8010002E;
        private const uint SCARD_E_READER_UNAVAILABLE = 0x80100017;
        private const uint SCARD_E_NO_SERVICE = 0x8010001D;
        private const uint SCARD_E_SERVICE_STOPPED = 0x8010001E;
        private const uint SCARD_E_CANCELLED = 0x80100002;
        private const uint SCARD_W_REMOVED_CARD = 0x80100069;
        private const uint SCARD_W_RESET_CARD = 0x80100068;

        // ── P/Invoke ─────────────────────────────────────────────────────

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct SCARD_IO_REQUEST
        {
            public uint dwProtocol;
            public uint cbPciLength;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct SCARD_READERSTATE
        {
            [MarshalAs(UnmanagedType.LPTStr)]
            public string szReader;
            public IntPtr pvUserData;
            public uint dwCurrentState;
            public uint dwEventState;
            public uint cbAtr;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 36)]
            public byte[] rgbAtr;
        }

        [DllImport("winscard.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern uint SCardEstablishContext(uint dwScope, IntPtr pvReserved1, IntPtr pvReserved2, out IntPtr phContext);

        [DllImport("winscard.dll", SetLastError = true)]
        private static extern uint SCardReleaseContext(IntPtr hContext);

        [DllImport("winscard.dll", SetLastError = true)]
        private static extern uint SCardCancel(IntPtr hContext);

        [DllImport("winscard.dll", CharSet = CharSet.Unicode, EntryPoint = "SCardListReadersW", SetLastError = true)]
        private static extern uint SCardListReaders(IntPtr hContext, byte[] mszGroups, byte[] mszReaders, ref uint pcchReaders);

        [DllImport("winscard.dll", CharSet = CharSet.Auto, EntryPoint = "SCardConnectW", SetLastError = true)]
        private static extern uint SCardConnect(IntPtr hContext, [MarshalAs(UnmanagedType.LPTStr)] string szReader, uint dwShareMode, uint dwPreferredProtocols, out IntPtr phCard, out uint pdwActiveProtocol);

        [DllImport("winscard.dll", SetLastError = true)]
        private static extern uint SCardDisconnect(IntPtr hCard, uint dwDisposition);

        [DllImport("winscard.dll", SetLastError = true)]
        private static extern uint SCardTransmit(IntPtr hCard, ref SCARD_IO_REQUEST pioSendPci, byte[] pbSendBuffer, uint cbSendLength, IntPtr pioRecvPci, byte[] pbRecvBuffer, ref uint pcbRecvLength);

        [DllImport("winscard.dll", CharSet = CharSet.Auto, EntryPoint = "SCardGetStatusChangeW", SetLastError = true)]
        private static extern uint SCardGetStatusChange(IntPtr hContext, uint dwTimeout, [In, Out] SCARD_READERSTATE[] rgReaderStates, uint cReaders);

        // I/O request strutture statiche per i protocolli T0/T1
        // sono esposte dal driver come simboli, ma e' piu' semplice costruirle.
        private static SCARD_IO_REQUEST GetSendPci(uint protocol)
        {
            SCARD_IO_REQUEST pci = new SCARD_IO_REQUEST();
            pci.dwProtocol = protocol;
            pci.cbPciLength = (uint)Marshal.SizeOf(typeof(SCARD_IO_REQUEST));
            return pci;
        }

        // ── Stato istanza ────────────────────────────────────────────────

        private IntPtr _hContext = IntPtr.Zero;
        private string _readerName;
        private volatile bool _stopRequested;
        private string _lastUid;
        private DateTime _lastUidTime = DateTime.MinValue;
        private readonly int _debounceMs;

        public PcscReader(int debounceMs)
        {
            _debounceMs = debounceMs;
        }

        public void Stop()
        {
            _stopRequested = true;
            if (_hContext != IntPtr.Zero)
            {
                SCardCancel(_hContext); // sblocca SCardGetStatusChange
            }
        }

        /// <summary>
        /// Stabilisce il contesto PC/SC. Lancia eccezione se fallisce.
        /// </summary>
        public void EstablishContext()
        {
            uint rc = SCardEstablishContext(SCARD_SCOPE_SYSTEM, IntPtr.Zero, IntPtr.Zero, out _hContext);
            if (rc != SCARD_S_SUCCESS)
                throw new InvalidOperationException("SCardEstablishContext failed: 0x" + rc.ToString("X8"));
        }

        /// <summary>
        /// Restituisce la lista dei lettori disponibili. Vuota se nessuno.
        /// Riprova internamente in caso di NO_READERS_AVAILABLE (errore non fatale).
        /// </summary>
        public List<string> ListReaders()
        {
            List<string> readers = new List<string>();
            uint pcchReaders = 0;
            uint rc = SCardListReaders(_hContext, null, null, ref pcchReaders);
            if (rc == SCARD_E_NO_READERS_AVAILABLE) return readers;
            if (rc != SCARD_S_SUCCESS)
                throw new InvalidOperationException("SCardListReaders (size) failed: 0x" + rc.ToString("X8"));

            byte[] buffer = new byte[pcchReaders * 2]; // Unicode
            rc = SCardListReaders(_hContext, null, buffer, ref pcchReaders);
            if (rc != SCARD_S_SUCCESS)
                throw new InvalidOperationException("SCardListReaders failed: 0x" + rc.ToString("X8"));

            // mszReaders e' una lista di stringhe Unicode separate da \0 e
            // terminata da \0\0.
            string raw = Encoding.Unicode.GetString(buffer, 0, (int)pcchReaders * 2);
            int start = 0;
            for (int i = 0; i < raw.Length; i++)
            {
                if (raw[i] == '\0')
                {
                    if (i > start)
                        readers.Add(raw.Substring(start, i - start));
                    start = i + 1;
                }
            }
            return readers;
        }

        /// <summary>
        /// Sceglie il lettore: usa preferred se non vuoto e presente nella lista,
        /// altrimenti il primo disponibile. Restituisce null se nessun lettore.
        /// </summary>
        public string SelectReader(string preferred)
        {
            List<string> readers = ListReaders();
            if (readers.Count == 0) return null;

            if (!string.IsNullOrEmpty(preferred))
            {
                foreach (string r in readers)
                {
                    if (r.IndexOf(preferred, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        _readerName = r;
                        return r;
                    }
                }
            }

            _readerName = readers[0];
            return _readerName;
        }

        /// <summary>
        /// Loop principale: attende l'inserimento di una carta, legge l'UID,
        /// invoca il callback, attende la rimozione, ripete. Esce quando
        /// Stop() viene chiamato o se _stopRequested diventa true.
        /// Eccezioni durante un singolo ciclo vengono loggate ma non terminano
        /// il loop (lettore staccato → si riavvia il polling).
        /// </summary>
        public void RunLoop(Action<string> onUidRead)
        {
            while (!_stopRequested)
            {
                if (string.IsNullOrEmpty(_readerName))
                {
                    // Riprova a trovare un lettore
                    string r = SelectReader(_readerName);
                    if (r == null)
                    {
                        Logger.Warn("Nessun lettore PC/SC disponibile, retry tra 3s");
                        SleepInterruptible(3000);
                        continue;
                    }
                    Logger.Info("Lettore selezionato: " + r);
                }

                try
                {
                    WaitForCardAndRead(onUidRead);
                }
                catch (Exception ex)
                {
                    Logger.Error("Errore nel loop PC/SC", ex);
                    _readerName = null; // forza re-discovery
                    SleepInterruptible(2000);
                }
            }
        }

        private void WaitForCardAndRead(Action<string> onUidRead)
        {
            // 1. Attendi che la carta venga inserita
            SCARD_READERSTATE[] states = new SCARD_READERSTATE[1];
            states[0] = new SCARD_READERSTATE();
            states[0].szReader = _readerName;
            states[0].dwCurrentState = SCARD_STATE_EMPTY;
            states[0].rgbAtr = new byte[36];

            // Polling con timeout 1s per poter rispondere a Stop()
            while (!_stopRequested)
            {
                uint rc = SCardGetStatusChange(_hContext, 1000, states, 1);
                if (rc == SCARD_E_TIMEOUT) continue;
                if (rc == SCARD_E_CANCELLED) return;
                if (rc == SCARD_E_NO_READERS_AVAILABLE || rc == SCARD_E_READER_UNAVAILABLE)
                {
                    _readerName = null;
                    throw new InvalidOperationException("Lettore non disponibile (0x" + rc.ToString("X8") + ")");
                }
                if (rc != SCARD_S_SUCCESS)
                    throw new InvalidOperationException("SCardGetStatusChange failed: 0x" + rc.ToString("X8"));

                if ((states[0].dwEventState & SCARD_STATE_PRESENT) != 0 &&
                    (states[0].dwEventState & SCARD_STATE_MUTE) == 0)
                {
                    break; // carta presente
                }
                states[0].dwCurrentState = states[0].dwEventState;
            }

            if (_stopRequested) return;

            // 2. Connetti, leggi UID, disconnetti
            string uid = null;
            try
            {
                uid = ReadUidFromPresentCard();
            }
            catch (Exception ex)
            {
                Logger.Warn("Lettura UID fallita: " + ex.Message);
            }

            if (!string.IsNullOrEmpty(uid))
            {
                // Debounce client-side
                bool skip = false;
                if (uid == _lastUid && (DateTime.Now - _lastUidTime).TotalMilliseconds < _debounceMs)
                {
                    skip = true;
                    Logger.Info("Debounce client: ignoro tap " + uid);
                }
                else
                {
                    _lastUid = uid;
                    _lastUidTime = DateTime.Now;
                }

                if (!skip)
                {
                    try { onUidRead(uid); }
                    catch (Exception ex) { Logger.Error("Callback onUidRead failed", ex); }
                }
            }

            // 3. Attendi rimozione
            states[0].dwCurrentState = SCARD_STATE_PRESENT;
            while (!_stopRequested)
            {
                uint rc = SCardGetStatusChange(_hContext, 1000, states, 1);
                if (rc == SCARD_E_TIMEOUT) continue;
                if (rc == SCARD_E_CANCELLED) return;
                if (rc != SCARD_S_SUCCESS) break;
                if ((states[0].dwEventState & SCARD_STATE_EMPTY) != 0) break;
                states[0].dwCurrentState = states[0].dwEventState;
            }
        }

        private string ReadUidFromPresentCard()
        {
            IntPtr hCard;
            uint protocol;
            uint rc = SCardConnect(_hContext, _readerName, SCARD_SHARE_SHARED, SCARD_PROTOCOL_ANY, out hCard, out protocol);
            if (rc != SCARD_S_SUCCESS)
                throw new InvalidOperationException("SCardConnect failed: 0x" + rc.ToString("X8"));

            try
            {
                // APDU GET DATA: FF CA 00 00 00 → richiede UID
                byte[] apdu = new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 };
                byte[] recv = new byte[258];
                uint recvLen = (uint)recv.Length;
                SCARD_IO_REQUEST pci = GetSendPci(protocol);

                rc = SCardTransmit(hCard, ref pci, apdu, (uint)apdu.Length, IntPtr.Zero, recv, ref recvLen);
                if (rc != SCARD_S_SUCCESS)
                    throw new InvalidOperationException("SCardTransmit failed: 0x" + rc.ToString("X8"));

                if (recvLen < 2)
                    throw new InvalidOperationException("Risposta APDU troppo corta (" + recvLen + " byte)");

                byte sw1 = recv[recvLen - 2];
                byte sw2 = recv[recvLen - 1];
                if (sw1 != 0x90 || sw2 != 0x00)
                    throw new InvalidOperationException("Status APDU non OK: SW=" + sw1.ToString("X2") + sw2.ToString("X2"));

                int uidLen = (int)(recvLen - 2);
                if (uidLen <= 0)
                    throw new InvalidOperationException("UID vuoto");

                StringBuilder sb = new StringBuilder(uidLen * 2);
                for (int i = 0; i < uidLen; i++)
                    sb.Append(recv[i].ToString("X2"));
                return sb.ToString();
            }
            finally
            {
                SCardDisconnect(hCard, SCARD_LEAVE_CARD);
            }
        }

        private void SleepInterruptible(int ms)
        {
            int slept = 0;
            while (slept < ms && !_stopRequested)
            {
                int chunk = Math.Min(200, ms - slept);
                Thread.Sleep(chunk);
                slept += chunk;
            }
        }

        public void Dispose()
        {
            try
            {
                if (_hContext != IntPtr.Zero)
                {
                    SCardReleaseContext(_hContext);
                    _hContext = IntPtr.Zero;
                }
            }
            catch { }
        }
    }
}
