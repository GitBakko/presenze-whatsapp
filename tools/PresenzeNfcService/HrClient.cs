using System;
using System.IO;
using System.Net;
using System.Text;

namespace PresenzeNfcService
{
    /// <summary>
    /// Client HTTP minimale per comunicare con il backend HR Presenze.
    ///
    /// Endpoint usati:
    ///   GET  /api/kiosk/health        — verifica connettivita' (no auth)
    ///   POST /api/kiosk/punch         — registra timbratura (Bearer ApiKey)
    ///
    /// JSON: niente serializer (in .NET 3.5 servirebbe System.Web.Extensions).
    /// Il payload e' un solo campo `uid` e la risposta ha pochi campi noti,
    /// quindi parsing manuale via piccoli helper string-based.
    /// </summary>
    public class HrClient
    {
        private readonly string _baseUrl;
        private readonly string _apiKey;
        private readonly int _timeoutMs;

        public HrClient(string baseUrl, string apiKey, int timeoutMs)
        {
            _baseUrl = baseUrl;
            _apiKey = apiKey;
            _timeoutMs = timeoutMs;

            // .NET 3.5 default e' SSL3/TLS1.0; se il server e' HTTPS moderno
            // potrebbe servire abilitare TLS 1.2 — ma fuori dallo scope (LAN HTTP).
            // Per sicurezza accettiamo certificati self-signed in HTTPS.
            ServicePointManager.ServerCertificateValidationCallback =
                delegate { return true; };
        }

        public class PunchResponse
        {
            public int HttpStatus;
            public string Status;          // ok | unknown_uid | too_soon | duplicate | bad_request | unauthorized | error
            public string Action;          // ENTRY | EXIT | PAUSE_START | PAUSE_END  (solo se ok)
            public string EmployeeName;
            public string Time;
            public string Error;
            public string RawBody;
        }

        public bool Health(out string serverTime, out string error)
        {
            serverTime = null;
            error = null;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(_baseUrl + "/api/kiosk/health");
                req.Method = "GET";
                req.Timeout = _timeoutMs;
                req.ReadWriteTimeout = _timeoutMs;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    string body = ReadBody(res);
                    serverTime = ExtractStringField(body, "serverTime");
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch (WebException wex)
            {
                error = wex.Message;
                return false;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        public PunchResponse Punch(string uid)
        {
            PunchResponse result = new PunchResponse();
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(_baseUrl + "/api/kiosk/punch");
                req.Method = "POST";
                req.Timeout = _timeoutMs;
                req.ReadWriteTimeout = _timeoutMs;
                req.ContentType = "application/json";
                req.Headers.Add("Authorization", "Bearer " + _apiKey);
                req.UserAgent = "PresenzeNfcService/1.0";

                string json = "{\"uid\":\"" + EscapeJsonString(uid) + "\"}";
                byte[] body = Encoding.UTF8.GetBytes(json);
                req.ContentLength = body.Length;
                using (Stream rs = req.GetRequestStream())
                    rs.Write(body, 0, body.Length);

                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    result.HttpStatus = (int)res.StatusCode;
                    result.RawBody = ReadBody(res);
                }
            }
            catch (WebException wex)
            {
                if (wex.Response != null)
                {
                    HttpWebResponse hr = (HttpWebResponse)wex.Response;
                    result.HttpStatus = (int)hr.StatusCode;
                    result.RawBody = ReadBody(hr);
                    hr.Close();
                }
                else
                {
                    result.HttpStatus = 0;
                    result.Error = wex.Message;
                    return result;
                }
            }
            catch (Exception ex)
            {
                result.HttpStatus = 0;
                result.Error = ex.Message;
                return result;
            }

            // Parse campi noti dalla risposta JSON
            result.Status = ExtractStringField(result.RawBody, "status");
            result.Action = ExtractStringField(result.RawBody, "action");
            result.EmployeeName = ExtractStringField(result.RawBody, "employeeName");
            result.Time = ExtractStringField(result.RawBody, "time");
            if (string.IsNullOrEmpty(result.Status))
                result.Status = result.HttpStatus >= 200 && result.HttpStatus < 300 ? "ok" : "error";
            if (string.IsNullOrEmpty(result.Error))
                result.Error = ExtractStringField(result.RawBody, "error");
            return result;
        }

        // ── Helpers ──────────────────────────────────────────────────────

        private static string ReadBody(HttpWebResponse res)
        {
            try
            {
                using (Stream s = res.GetResponseStream())
                using (StreamReader sr = new StreamReader(s, Encoding.UTF8))
                    return sr.ReadToEnd();
            }
            catch
            {
                return "";
            }
        }

        private static string EscapeJsonString(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else
                            sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        /// <summary>
        /// Estrazione di un campo stringa da un JSON flat: cerca "key":"value".
        /// Sufficiente per le risposte semplici dell'endpoint kiosk; non gestisce
        /// nesting, array, ne' valori non-string.
        /// </summary>
        private static string ExtractStringField(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return null;
            string needle = "\"" + key + "\"";
            int idx = json.IndexOf(needle);
            if (idx < 0) return null;
            int colon = json.IndexOf(':', idx + needle.Length);
            if (colon < 0) return null;
            int i = colon + 1;
            // skip spazi
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
            if (i >= json.Length) return null;
            if (json[i] != '"') return null; // non e' una stringa
            i++;
            StringBuilder sb = new StringBuilder();
            while (i < json.Length)
            {
                char c = json[i];
                if (c == '\\' && i + 1 < json.Length)
                {
                    char nx = json[i + 1];
                    switch (nx)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        default: sb.Append(nx); break;
                    }
                    i += 2;
                    continue;
                }
                if (c == '"') return sb.ToString();
                sb.Append(c);
                i++;
            }
            return sb.ToString();
        }
    }
}
