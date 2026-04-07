# PresenzeNfcService — checklist smoke test sul PC postazione

Checklist da eseguire fisicamente sul PC target (Windows 7+ x86) la prima volta.

## 1. Prerequisiti OS

- [ ] Windows ≥ 7 (x86 o x64 va bene, ma usa il binario x86)
- [ ] .NET Framework 3.5 installato. Se Windows 8/10/11:
      ```cmd
      dism /online /enable-feature /featurename:NetFx3 /all
      ```
- [ ] Servizio "Smart Card" di Windows attivo:
      ```cmd
      sc query SCardSvr
      sc config SCardSvr start= auto
      sc start SCardSvr
      ```

## 2. Driver lettore

- [ ] Scarica driver bit4id miniLector AIR 3 da bit4id.com
- [ ] Installa, riavvia se richiesto
- [ ] Collega il lettore via USB
- [ ] Device Manager → "Smart card readers" → deve comparire "Bit4id miniLector-AIR" o nome simile, **senza punto esclamativo giallo**

## 3. Verifica lettore con il binario

- [ ] Copia `PresenzeNfcService.exe` e `config.template.ini` in una cartella di lavoro (es. `C:\PresenzeNfc\`)
- [ ] Da prompt:
      ```cmd
      cd C:\PresenzeNfc
      PresenzeNfcService.exe --probe
      ```
- [ ] Output atteso: `Lettori trovati (1):` seguito dal nome del lettore. Se "Nessun lettore", torna allo step 2.

## 4. Configurazione

- [ ] `copy config.template.ini config.ini`
- [ ] Apri `config.ini` con notepad e compila:
  - [ ] `url` = endpoint del backend HR (es. `http://192.168.1.10:3000`)
  - [ ] `api_key` = chiave generata in **Impostazioni → Chiavi API** del backend
- [ ] Test connettività:
      ```cmd
      curl http://192.168.1.10:3000/api/kiosk/health
      ```
      Deve rispondere `{"ok":true,...}`.

## 5. Test interattivo (modalità console)

- [ ] Da prompt non-admin:
      ```cmd
      PresenzeNfcService.exe --console
      ```
- [ ] Il log dovrebbe mostrare:
      ```
      [INFO] Servizio avviato. Server=... Reader=(auto)
      [INFO] Health OK, serverTime=...
      [INFO] Lettore selezionato: Bit4id miniLector-AIR ...
      ```
- [ ] **Test 1: tessera non associata**
  - Appoggia una qualsiasi tessera contactless mai vista al server
  - Atteso: log `Tap UID=... → 404 unknown_uid`, suono "3 beep medi"
  - Verifica nel backend: **Impostazioni → Postazione NFC** mostra l'UID nella tabella "Tessere non riconosciute"
- [ ] **Test 2: associazione**
  - Dal backend HR, associa l'UID a un dipendente di test
- [ ] **Test 3: tap riconosciuto (ENTRY)**
  - Riappoggia la stessa tessera
  - Atteso: log `Tap UID=... → 201 ENTRY (Nome Cognome)`, suono "do→mi" ascendente
  - Verifica nel backend: nuovo record di tipo ENTRY per oggi
- [ ] **Test 4: secondo tap immediato (debounce)**
  - Riappoggia entro 5 secondi
  - Atteso: log `→ 429 too_soon`, suono "buzz errore" — **NESSUN nuovo record**
- [ ] **Test 5: tap dentro orario lavorativo (PAUSE)**
  - Aspetta >10 secondi e ritappa (sei ancora "AL_LAVORO" dal Test 3)
  - Se l'ora corrente è dentro lo schedule del dipendente: atteso `PAUSE_START`, suono singolo
  - Se sei fuori orario: atteso `EXIT`, suono discendente
- [ ] **Test 6: continua il ciclo**
  - Tappa di nuovo dopo 10s → `PAUSE_END` o `ENTRY` a seconda dello stato
- [ ] CTRL+C per uscire

## 6. Installazione come servizio

- [ ] Apri prompt **come Amministratore**
- [ ] `PresenzeNfcService.exe --install`
- [ ] `sc start PresenzeNfcService`
- [ ] `sc query PresenzeNfcService` → deve mostrare `STATE: 4 RUNNING`
- [ ] Verifica i log in `C:\ProgramData\PresenzeNfcService\logs\service-YYYYMMDD.log`
- [ ] Tappa una tessera → deve registrarsi come prima
- [ ] **Verifica audio**: il beep si sente? (Session 0 può essere muta su alcune configurazioni)
  - Se NON si sente: ferma il servizio, riavvialo da `--console` come utente loggato, verifica che lì il suono funzioni
  - Workaround: lascia il servizio in autostart utente (chiave Run del registro) invece che come Service. Da valutare.

## 7. Persistenza dopo riavvio

- [ ] Riavvia il PC
- [ ] Loggati come utente normale
- [ ] `sc query PresenzeNfcService` → deve essere già RUNNING
- [ ] Tappa una tessera → deve funzionare senza intervento

## 8. Stress test (opzionale ma consigliato)

- [ ] 50 tap consecutivi alternando 2-3 tessere diverse
- [ ] Monitor risorse: il processo `PresenzeNfcService.exe` non deve superare 50 MB di RAM né crescere indefinitamente
- [ ] Tutti i record arrivano nel backend (verifica conteggio in `/api/records`)

## 9. Resilienza

- [ ] Stacca e riattacca il lettore USB → il log mostra "Nessun lettore PC/SC disponibile, retry tra 3s" e poi "Lettore selezionato: ..." quando lo ricolleghi
- [ ] Spegni temporaneamente il server HR → tap → log `→ 0 error: Unable to connect to the remote server`, beep errore. Riaccendi server → tap → ritorna a funzionare.

## 10. Disinstallazione (per fine test)

```cmd
sc stop PresenzeNfcService
PresenzeNfcService.exe --uninstall
```

I log restano in `C:\ProgramData\PresenzeNfcService\logs\` — eliminali manualmente se vuoi pulire tutto.
