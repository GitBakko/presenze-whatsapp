using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace PresenzeNfcService
{
    /// <summary>
    /// Configurazione del servizio. Caricata da config.ini accanto al .exe (o
    /// in <see cref="DefaultConfigPath"/> per il servizio installato).
    ///
    /// Formato INI minimale: sezioni [name] e coppie key = value, # o ; per i
    /// commenti. Niente quoting.
    /// </summary>
    public class Config
    {
        public string ServerUrl;
        public string ApiKey;
        public int TimeoutMs;
        public string PreferredReader;
        public int DebounceMs;
        public string LogPath;

        public static string DefaultConfigPath
        {
            get
            {
                string exeDir = Path.GetDirectoryName(
                    System.Reflection.Assembly.GetExecutingAssembly().Location);
                return Path.Combine(exeDir, "config.ini");
            }
        }

        public static Config LoadOrThrow(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException(
                    "File di configurazione non trovato: " + path +
                    ". Copia config.template.ini in config.ini e compila i campi.");
            }

            Dictionary<string, Dictionary<string, string>> ini = ParseIni(path);
            Config c = new Config();
            c.ServerUrl = GetReq(ini, "server", "url");
            c.ApiKey = GetReq(ini, "server", "api_key");
            c.TimeoutMs = GetIntOpt(ini, "server", "timeout_ms", 5000);
            c.PreferredReader = GetOpt(ini, "reader", "preferred_name", "");
            c.DebounceMs = GetIntOpt(ini, "reader", "debounce_ms", 2500);
            c.LogPath = GetOpt(ini, "log", "path", "");

            // Validazioni minime
            if (c.ServerUrl.Length == 0)
                throw new InvalidDataException("Config: [server] url non puo' essere vuoto");
            if (c.ApiKey.Length == 0)
                throw new InvalidDataException("Config: [server] api_key non puo' essere vuoto");
            if (!c.ServerUrl.StartsWith("http://") && !c.ServerUrl.StartsWith("https://"))
                throw new InvalidDataException("Config: [server] url deve iniziare con http:// o https://");

            // Normalizza: rimuovi slash finale
            while (c.ServerUrl.EndsWith("/"))
                c.ServerUrl = c.ServerUrl.Substring(0, c.ServerUrl.Length - 1);

            return c;
        }

        // ── Parser INI minimale ──────────────────────────────────────────

        private static Dictionary<string, Dictionary<string, string>> ParseIni(string path)
        {
            Dictionary<string, Dictionary<string, string>> result =
                new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            string currentSection = "";
            result[currentSection] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            string[] lines = File.ReadAllLines(path, Encoding.UTF8);
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.Length == 0) continue;
                if (line[0] == '#' || line[0] == ';') continue;

                if (line[0] == '[' && line[line.Length - 1] == ']')
                {
                    currentSection = line.Substring(1, line.Length - 2).Trim();
                    if (!result.ContainsKey(currentSection))
                        result[currentSection] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    continue;
                }

                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string key = line.Substring(0, eq).Trim();
                string value = line.Substring(eq + 1).Trim();
                result[currentSection][key] = value;
            }
            return result;
        }

        private static string GetReq(Dictionary<string, Dictionary<string, string>> ini, string section, string key)
        {
            string v = GetOpt(ini, section, key, null);
            if (v == null)
                throw new InvalidDataException("Config: chiave obbligatoria mancante: [" + section + "] " + key);
            return v;
        }

        private static string GetOpt(Dictionary<string, Dictionary<string, string>> ini, string section, string key, string fallback)
        {
            Dictionary<string, string> sec;
            if (!ini.TryGetValue(section, out sec)) return fallback;
            string v;
            if (!sec.TryGetValue(key, out v)) return fallback;
            return v;
        }

        private static int GetIntOpt(Dictionary<string, Dictionary<string, string>> ini, string section, string key, int fallback)
        {
            string v = GetOpt(ini, section, key, null);
            if (string.IsNullOrEmpty(v)) return fallback;
            int parsed;
            if (int.TryParse(v, out parsed)) return parsed;
            return fallback;
        }
    }
}
