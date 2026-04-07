using System;
using System.ServiceProcess;
using System.Threading;

namespace PresenzeNfcService
{
    /// <summary>
    /// Servizio Windows: avvia un thread worker che gestisce il loop PC/SC
    /// e per ogni UID letto chiama il backend HR e suona il feedback.
    /// </summary>
    public class NfcService : ServiceBase
    {
        public const string SERVICE_NAME = "PresenzeNfcService";

        private Thread _worker;
        private PcscReader _reader;
        private HrClient _client;
        private Config _config;
        private volatile bool _running;

        public NfcService()
        {
            this.ServiceName = SERVICE_NAME;
            this.CanStop = true;
            this.CanShutdown = true;
            this.CanPauseAndContinue = false;
            this.AutoLog = false; // usiamo il nostro Logger
        }

        protected override void OnStart(string[] args)
        {
            try
            {
                StartWorker();
            }
            catch (Exception ex)
            {
                Logger.Error("OnStart fallito", ex);
                throw;
            }
        }

        protected override void OnStop()
        {
            StopWorker();
        }

        protected override void OnShutdown()
        {
            StopWorker();
        }

        public void StartWorker()
        {
            _config = Config.LoadOrThrow(Config.DefaultConfigPath);
            Logger.Init(_config.LogPath);
            Logger.Info("Servizio avviato. Server=" + _config.ServerUrl + " Reader=" +
                        (string.IsNullOrEmpty(_config.PreferredReader) ? "(auto)" : _config.PreferredReader));

            Beeper.Init();
            _client = new HrClient(_config.ServerUrl, _config.ApiKey, _config.TimeoutMs);
            _reader = new PcscReader(_config.DebounceMs);
            _reader.EstablishContext();

            // Health-check non bloccante allo startup
            string serverTime;
            string hcErr;
            if (_client.Health(out serverTime, out hcErr))
                Logger.Info("Health OK, serverTime=" + serverTime);
            else
                Logger.Warn("Health KO: " + hcErr + " (proseguo comunque)");

            _running = true;
            _worker = new Thread(WorkerLoop);
            _worker.IsBackground = true;
            _worker.Name = "PcscWorker";
            _worker.Start();
        }

        public void StopWorker()
        {
            _running = false;
            try
            {
                if (_reader != null) _reader.Stop();
            }
            catch { }

            if (_worker != null && _worker.IsAlive)
            {
                if (!_worker.Join(5000))
                    Logger.Warn("Worker non terminato entro 5s");
            }

            try
            {
                if (_reader != null) _reader.Dispose();
            }
            catch { }

            Logger.Info("Servizio arrestato");
        }

        private void WorkerLoop()
        {
            try
            {
                _reader.RunLoop(HandleUid);
            }
            catch (Exception ex)
            {
                Logger.Error("WorkerLoop terminato per eccezione", ex);
            }
        }

        private void HandleUid(string uid)
        {
            Logger.Info("Tap UID=" + uid);
            HrClient.PunchResponse res = _client.Punch(uid);

            string label = res.Action ?? res.Status ?? ("HTTP " + res.HttpStatus);
            string who = string.IsNullOrEmpty(res.EmployeeName) ? "" : " (" + res.EmployeeName + ")";
            Logger.Info("→ " + res.HttpStatus + " " + label + who +
                        (string.IsNullOrEmpty(res.Error) ? "" : " err=" + res.Error));

            // Mappatura risposta → suono
            if (res.HttpStatus == 0)
            {
                Beeper.Play(Beeper.Sound.Error); // rete giù
                return;
            }
            if (res.HttpStatus >= 200 && res.HttpStatus < 300)
            {
                switch (res.Action)
                {
                    case "ENTRY":
                        Beeper.Play(Beeper.Sound.Entry); break;
                    case "EXIT":
                        Beeper.Play(Beeper.Sound.Exit); break;
                    case "PAUSE_START":
                    case "PAUSE_END":
                        Beeper.Play(Beeper.Sound.Pause); break;
                    default:
                        Beeper.Play(Beeper.Sound.Entry); break;
                }
                return;
            }
            if (res.HttpStatus == 404 && res.Status == "unknown_uid")
            {
                Beeper.Play(Beeper.Sound.Unknown);
                return;
            }
            if (res.HttpStatus == 429 || res.HttpStatus == 409)
            {
                // tap troppo ravvicinato o duplicato esatto: beep error breve
                Beeper.Play(Beeper.Sound.Error);
                return;
            }
            // 4xx/5xx generici
            Beeper.Play(Beeper.Sound.Error);
        }

        // ── Modalita' console (debug interattivo) ────────────────────────

        public void RunConsole()
        {
            Console.WriteLine("=== PresenzeNfcService — modalita' console ===");
            Console.WriteLine("Premi CTRL+C per uscire.");
            Console.CancelKeyPress += delegate(object s, ConsoleCancelEventArgs e)
            {
                e.Cancel = true;
                _running = false;
                StopWorker();
            };

            try
            {
                StartWorker();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Avvio fallito: " + ex.Message);
                return;
            }

            while (_running)
            {
                Thread.Sleep(500);
            }
        }
    }
}
