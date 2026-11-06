# Dispensa: documentazione (v1.1)

App web per l'inventario della dispensa, condivisa in famiglia.
- **Frontend:** GitHub Pages.
- **Database:** Google Sheet, gestito tramite Apps Script.
- **Ponte facoltativo:** Home Assistant, per la lista spesa di Alexa.

| File | Dove va |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png` | Repo GitHub, nella radice |
| `Code.gs` | Apps Script del Google Sheet |
| `dispensa_alexa.yaml` | Home Assistant, in `/config/packages/` |

---

## A. Aggiornamento da v1.0 → v1.1 (≈5 minuti)
1. **Backend**
   1. Apri il Google Sheet → **Estensioni → Apps Script**.
   2. Annota il tuo `TOKEN` attuale.
   3. Sostituisci tutto il codice con il nuovo `Code.gs` e **reinserisci lo stesso TOKEN**.
   4. Salva.
2. Seleziona la funzione `setup` e premi **Esegui**.
   - Aggiunge la colonna `stato` e il foglio `Spesa`, e crea il trigger mensile di pulizia dello storico.
   - Non tocca i dati esistenti.
   - Autorizza la nuova richiesta di permessi: serve per i trigger.
3. **Esegui il deployment → Gestisci deployment → ✏️ (modifica) → Versione: Nuova versione → Esegui il deployment.**
   - L'URL `/exec` resta lo stesso: sui telefoni non va cambiato nulla.
   - ⚠️ Se crei un "Nuovo deployment" invece di modificare quello esistente, l'URL cambia.
4. **Frontend:** nel repo GitHub sostituisci `index.html` e `sw.js` con **Add file → Upload files** e premi **Commit changes**.
5. **Telefoni:** chiudi e riapri l'app. Se resta la versione vecchia, riaprila una seconda volta: la prima apertura scarica l'aggiornamento.
6. **Verifica:** in ⚙︎ Impostazioni, in fondo, deve comparire **v1.1**.

Ordine consigliato: prima il backend, poi il frontend. La vecchia app funziona anche con il nuovo backend.

---

## B. Primo setup (installazione nuova)

### B1. Backend (Google Sheet)
1. Crea un nuovo Google Sheet, ad esempio "Dispensa DB".
2. Vai su **Estensioni → Apps Script**, cancella il contenuto e incolla `Code.gs`.
3. Cambia `TOKEN` con una parola segreta a tua scelta.
4. Seleziona la funzione `setup` e premi **Esegui** (autorizza l'accesso).
5. **Esegui il deployment → Nuovo deployment → App web**: esegui come *Me*, accesso *Chiunque*.
6. Copia l'URL che finisce con `/exec`.

### B2. Frontend (GitHub Pages)
1. Crea un nuovo repo **pubblico**, ad esempio `dispensa`. Su GitHub gratuito Pages non funziona con i repo privati.
2. Carica i 5 file del frontend **nella radice del repo**.
3. Vai su **Settings → Pages → Source: Deploy from a branch → Branch: main → / (root) → Save** e aspetta 1–2 minuti.
4. Apri il link indicato in Settings → Pages ("Your site is live at …"). È su **github.io**, non su github.com.
5. Su iPhone, in Safari: **Condividi → Aggiungi alla schermata Home**.

### B3. Primo avvio
- Inserisci il tuo nome, l'URL `/exec` e il token, poi premi **Collega**.
- Poi vai su ⚙︎ → **Invia link di configurazione** e mandalo ad Alba. Lei apre il link, aggiunge l'app alla Home e lo incolla nel campo URL: URL e token si compilano da soli.

### B4. Riservatezza
- Il repo pubblico contiene solo il codice. Dati, URL e token restano nel Google Sheet e sui telefoni.
- **Non scrivere mai URL o token nei file del repo.**

---

## C. Uso

| Azione | Come |
|---|---|
| Check-out veloce | ▥ in modalità **− Usa**: inquadri e scala 1, e lo scanner resta aperto |
| Rientro dalla spesa | ▥ in modalità **+ Carica**: ogni scansione aggiunge 1 |
| Controllo o modifica puntuale | ▥ in modalità **Chiedi** |
| Prodotto nuovo | Si apre subito il form, già compilato da Open Food Facts. Completi i campi evidenziati |
| Al volo dalla lista | Tasti − / + su ogni riga |
| Mettere in lista spesa un prodotto | Scheda prodotto → **🛒 Metti in lista spesa** |
| Voce libera (non in dispensa) | Scheda Spesa → campo in alto → ＋ |

### Le tre modalità dello scanner
| Modalità | Prodotto già noto | Quando usarla |
|---|---|---|
| **− Usa** (predefinita) | Toglie 1 subito, con un bip, e lo scanner resta aperto | Quando prendi qualcosa |
| **+ Carica** | Aggiunge 1 subito, con un bip, e lo scanner resta aperto | Al rientro dalla spesa |
| **Chiedi** | Apre la scheda senza cambiare nulla | Per controllare, cambiare più unità insieme (+ sei volte per una confezione da 6), aggiornare scadenza, posizione o note, correggere una scansione |

Con **Fatto** lo scanner riprende da solo. Un prodotto **mai visto** apre sempre il form, in qualunque modalità.

### Lista spesa: come si riempie e come si svuota
**Entra in lista quando:**
- la quantità scende **sotto la scorta minima**;
- la segni a mano con **🛒 Metti in lista spesa**;
- la chiedi ad Alexa ("Alexa, aggiungi latte alla lista della spesa");
- la aggiungi come **voce libera**.

**Si spunta** quando sei al supermercato: la voce passa in "Nel carrello". La spunta è condivisa tra i telefoni e con Alexa.

**Esce da sola quando carichi il prodotto** con lo scanner o con il +:
- se raggiunge la scorta minima, oppure se era "da comprare" o "nel carrello";
- se è ancora sotto la scorta (ad esempio minimo 2 e ne hai comprato 1), resta in lista.

**Voci libere:**
- spariscono da sole quando carichi o registri un prodotto con nome corrispondente (ad esempio "candele" ↔ "Candele profumate");
- le altre si tolgono con **Rimuovi voci libere spuntate**.

---

## D. Collegamento con la lista spesa di Alexa (facoltativo)

**Requisiti:**
- Home Assistant **2026.7** o successivo, con l'integrazione **Alexa Devices**;
- account Amazon con verifica in due passaggi tramite **app di autenticazione**;
- Alexa Media Player, se c'è, può restare.

**Installazione:**
1. In `configuration.yaml`, sotto `homeassistant:`, aggiungi `packages: !include_dir_named packages`.
2. Copia `dispensa_alexa.yaml` in `/config/packages/`.
3. In `secrets.yaml` aggiungi:
   `dispensa_url: "https://script.google.com/macros/s/XXXX/exec?token=IL-TUO-TOKEN"`
4. Nel file YAML sostituisci `todo.alexa_shopping_list` con il nome esatto della tua entità (lo trovi in Strumenti per sviluppatori → Stati → filtro `todo.`).
5. **Verifica configurazione → Riavvia.**

**Come funziona:**
- ogni 5 minuti, e a ogni cambio della lista Alexa, Home Assistant manda la lista Alexa al Google Sheet;
- il Google Sheet risponde con cosa aggiungere o spuntare su Alexa.

| Evento | Effetto |
|---|---|
| Prodotto in lista nella Dispensa | Compare su Alexa |
| "Alexa, aggiungi latte" e "Latte …" esiste nella dispensa | Il prodotto viene segnato da comprare; su Alexa la voce prende il nome completo del prodotto |
| "Alexa, aggiungi candele" e il prodotto non esiste | Diventa una voce libera |
| Spunti la voce sull'app Alexa | Passa in "Nel carrello" nella Dispensa |
| Carichi il prodotto o lo togli dalla lista | Viene spuntato su Alexa |

**Test:** Strumenti per sviluppatori → Azioni → `automation.trigger` → "Dispensa ⇄ Alexa lista spesa". Poi controlla la lista nell'app Alexa e nella Dispensa.

**Limiti:**
- ritardo massimo di circa 5 minuti;
- il confronto tra nomi ignora maiuscole e accenti, ma nomi molto diversi ("bibite" ↔ "Coca-Cola") non vengono collegati;
- dipende dall'integrazione Alexa Devices: se Amazon cambia qualcosa, potrebbe smettere di funzionare.

---

## E. Dati (Google Sheet)

| Foglio | Contenuto | Crescita |
|---|---|---|
| **Prodotti** | Una riga per prodotto. Resta anche a quantità 0, così il codice a barre viene riconosciuto alla prossima scansione | Cresce solo con prodotti nuovi. Si toglie con Modifica → Elimina |
| **Spesa** | Voci libere della lista | Si svuota da sola o con "Rimuovi spuntate" |
| **Movimenti** | Storico: quando, chi, cosa, ± quantità | **Pulizia automatica il 1° di ogni mese**, tiene gli ultimi 12 mesi (`STORICO_MESI` in `Code.gs`) |

**Campi del prodotto:**
- nome, marca, formato, categoria, posizione;
- qty, scortaMin, scadenza;
- note, img, barcode;
- stato: vuoto, `comprare` o `preso`.

**Prestazioni:**
- ogni richiesta fa **una lettura e una scrittura** sul foglio, qualunque sia il numero di modifiche in coda;
- l'app non legge mai lo storico;
- la latenza di Apps Script (1–2 secondi) non si percepisce, perché l'app aggiorna subito lo schermo e sincronizza dopo.

**Concorrenza:**
- le quantità vengono sempre aggiornate per **differenza**. Due persone che modificano insieme lo stesso prodotto non si annullano a vicenda;
- un lock su Apps Script mette in fila le richieste simultanee.

---

## F. Note
- Funziona anche **offline**: le modifiche restano in coda e si sincronizzano appena torna la rete.
- Su iPhone la fotocamera può chiedere il permesso a ogni avvio dalla Home. È un limite di iOS.
- Dopo ogni modifica a `Code.gs`: **Gestisci deployment → modifica → Nuova versione**, mai "Nuovo deployment".
- Il pulsante "Prova senza cloud" serve solo per provare l'app: i dati restano su quel telefono.

## G. Changelog
**v1.1 (06/11/2026)**
- Corretto: modificando un prodotto (ad esempio la scadenza) si poteva annullare un − / + fatto nello stesso momento da un altro telefono.
- Corretto: in modalità "senza cloud" la coda di sincronizzazione cresceva all'infinito.
- Backend riscritto: una lettura e una scrittura per richiesta; storico scritto in blocco.
- Pulizia automatica dello storico: 12 mesi, trigger mensile.
- Lista spesa condivisa:
  - "da comprare" a mano;
  - voci libere;
  - spunte "nel carrello" sincronizzate;
  - uscita automatica dalla lista al carico, anche per le voci libere.
- Sincronizzazione bidirezionale con la lista spesa di Alexa tramite Home Assistant.

**v1.0 (06/11/2026):** prima versione.
