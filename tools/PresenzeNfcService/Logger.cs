using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace PresenzeNfcService
{
    /// <summary>
    /// Logger semplice: file rotativo (1 file al giorno) + EventLog di Windows
    /// per gli errori. Thread-safe via lock. Niente dipendenze esterne.
    ///
    /// Default path: %ProgramData%\PresenzeNfcService\logs\service-YYYYMMDD.log
    /// </summary>
    public static class Logger
    {
        private static readonly object _lock = new object();
        private static string _logDir;
        private static string _eventSource = "PresenzeNfcService";
        private static bool _eventLogReady;

        public static void Init(string customPath)
        {
            if (string.IsNullOrEmpty(customPath))
            {
                string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                _logDir = Path.Combine(Path.Combine(programData, "PresenzeNfcService"), "logs");
            }
            else
            {
                _logDir = customPath;
            }

            try
            {
                if (!Directory.Exists(_logDir))
                    Directory.CreateDirectory(_logDir);
            }
            catch
            {
                // Se non posso scrivere nel path, fallback alla cartella del .exe
                _logDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            }

            // EventLog source: serve admin per crearlo la prima volta. Se fallisce
            // (es. utente non admin), proseguo senza EventLog.
            try
            {
                if (!EventLog.SourceExists(_eventSource))
                    EventLog.CreateEventSource(_eventSource, "Application");
                _eventLogReady = true;
            }
            catch
            {
                _eventLogReady = false;
            }
        }

        public static void Info(string message)
        {
            Write("INFO", message);
        }

        public static void Warn(string message)
        {
            Write("WARN", message);
            WriteEvent(message, EventLogEntryType.Warning);
        }

        public static void Error(string message)
        {
            Write("ERROR", message);
            WriteEvent(message, EventLogEntryType.Error);
        }

        public static void Error(string message, Exception ex)
        {
            string full = message + " | " + ex.GetType().Name + ": " + ex.Message + Environment.NewLine + ex.StackTrace;
            Write("ERROR", full);
            WriteEvent(message + " — " + ex.Message, EventLogEntryType.Error);
        }

        private static void Write(string level, string message)
        {
            if (string.IsNullOrEmpty(_logDir)) return;
            try
            {
                lock (_lock)
                {
                    string file = Path.Combine(_logDir, "service-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
                    string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "] [" + level + "] " + message + Environment.NewLine;
                    File.AppendAllText(file, line, Encoding.UTF8);
                    // Mirror anche su stdout se siamo in console mode
                    Console.Out.Write(line);
                }
            }
            catch
            {
                // log fail = non posso fare niente
            }
        }

        private static void WriteEvent(string message, EventLogEntryType type)
        {
            if (!_eventLogReady) return;
            try
            {
                EventLog.WriteEntry(_eventSource, message, type);
            }
            catch
            {
                // ignore
            }
        }
    }
}
