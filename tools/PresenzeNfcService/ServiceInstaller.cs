using System.ComponentModel;
using System.Configuration.Install;
using System.ServiceProcess;

namespace PresenzeNfcService
{
    /// <summary>
    /// Installer del servizio Windows. Viene invocato automaticamente da
    /// <see cref="System.Configuration.Install.ManagedInstallerClass.InstallHelper"/>
    /// quando l'utente lancia il .exe con --install / --uninstall.
    ///
    /// Account: LocalSystem (necessario per lettore PC/SC e accesso audio
    /// in Session 0; in alternativa NetworkService funziona di solito ma il
    /// driver bit4id richiede a volte privilegi piu' alti per la prima
    /// inizializzazione).
    /// Avvio: automatico al boot.
    /// </summary>
    [RunInstaller(true)]
    public class ProjectInstaller : Installer
    {
        public ProjectInstaller()
        {
            ServiceProcessInstaller processInstaller = new ServiceProcessInstaller();
            processInstaller.Account = ServiceAccount.LocalSystem;

            ServiceInstaller serviceInstaller = new ServiceInstaller();
            serviceInstaller.ServiceName = NfcService.SERVICE_NAME;
            serviceInstaller.DisplayName = "Presenze NFC Kiosk";
            serviceInstaller.Description = "Legge le tessere CIE/NFC dalla postazione di ingresso e registra le timbrature sul server HR Presenze.";
            serviceInstaller.StartType = ServiceStartMode.Automatic;

            this.Installers.Add(processInstaller);
            this.Installers.Add(serviceInstaller);
        }
    }
}
