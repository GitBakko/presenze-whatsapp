using System;
using System.Configuration.Install;
using System.IO;
using System.Reflection;
using System.ServiceProcess;

namespace PresenzeNfcService
{
    public static class Program
    {
        public static int Main(string[] args)
        {
            // CLI:
            //   PresenzeNfcService.exe                       → service mode
            //   PresenzeNfcService.exe --console             → run interattivo
            //   PresenzeNfcService.exe --install             → installa servizio
            //   PresenzeNfcService.exe --uninstall           → disinstalla
            //   PresenzeNfcService.exe --probe               → elenca lettori PC/SC e termina
            //   PresenzeNfcService.exe --version

            string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "";

            try
            {
                switch (mode)
                {
                    case "":
                        // Avvio come servizio
                        ServiceBase.Run(new ServiceBase[] { new NfcService() });
                        return 0;

                    case "--console":
                    case "-c":
                        Logger.Init(null);
                        new NfcService().RunConsole();
                        return 0;

                    case "--install":
                    case "-i":
                        return Install();

                    case "--uninstall":
                    case "-u":
                        return Uninstall();

                    case "--probe":
                    case "-p":
                        return Probe();

                    case "--version":
                    case "-v":
                        Console.WriteLine("PresenzeNfcService " + Assembly.GetExecutingAssembly().GetName().Version);
                        return 0;

                    case "--help":
                    case "-h":
                    case "/?":
                        PrintHelp();
                        return 0;

                    default:
                        Console.Error.WriteLine("Argomento sconosciuto: " + mode);
                        PrintHelp();
                        return 1;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERRORE: " + ex.Message);
                Console.Error.WriteLine(ex.StackTrace);
                return 2;
            }
        }

        private static int Install()
        {
            string exePath = Assembly.GetExecutingAssembly().Location;
            Console.WriteLine("Installazione servizio da: " + exePath);

            // Verifica config.ini accanto al .exe
            string cfgPath = Config.DefaultConfigPath;
            if (!File.Exists(cfgPath))
            {
                Console.Error.WriteLine("ATTENZIONE: " + cfgPath + " non trovato.");
                Console.Error.WriteLine("Copia config.template.ini in config.ini e compila i campi prima di avviare il servizio.");
                // Non blocco l'installazione: si puo' creare dopo.
            }

            ManagedInstallerClass.InstallHelper(new string[] { exePath });
            Console.WriteLine("Servizio installato. Avvialo con: sc start " + NfcService.SERVICE_NAME);
            return 0;
        }

        private static int Uninstall()
        {
            string exePath = Assembly.GetExecutingAssembly().Location;
            Console.WriteLine("Disinstallazione servizio: " + exePath);
            ManagedInstallerClass.InstallHelper(new string[] { "/u", exePath });
            Console.WriteLine("Servizio disinstallato.");
            return 0;
        }

        private static int Probe()
        {
            Logger.Init(null);
            Console.WriteLine("Probe lettori PC/SC...");
            using (PcscReader r = new PcscReader(0))
            {
                try
                {
                    r.EstablishContext();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("SCardEstablishContext fallito: " + ex.Message);
                    return 1;
                }

                System.Collections.Generic.List<string> readers = r.ListReaders();
                if (readers.Count == 0)
                {
                    Console.WriteLine("Nessun lettore PC/SC trovato. Verifica che il driver bit4id sia installato e che il dispositivo sia collegato.");
                    return 1;
                }
                Console.WriteLine("Lettori trovati (" + readers.Count + "):");
                for (int i = 0; i < readers.Count; i++)
                    Console.WriteLine("  [" + i + "] " + readers[i]);
            }
            return 0;
        }

        private static void PrintHelp()
        {
            Console.WriteLine("PresenzeNfcService — kiosk NFC per HR Presenze");
            Console.WriteLine("");
            Console.WriteLine("Uso:");
            Console.WriteLine("  PresenzeNfcService.exe              avvia come servizio Windows");
            Console.WriteLine("  PresenzeNfcService.exe --console    esecuzione interattiva (debug)");
            Console.WriteLine("  PresenzeNfcService.exe --install    installa il servizio (richiede admin)");
            Console.WriteLine("  PresenzeNfcService.exe --uninstall  disinstalla il servizio (richiede admin)");
            Console.WriteLine("  PresenzeNfcService.exe --probe      elenca lettori PC/SC e termina");
            Console.WriteLine("  PresenzeNfcService.exe --version    mostra la versione");
        }

    }
}
