# Dispensa: setup (≈10 minuti, una volta sola)

## 1. Backend (Google Sheet)
1. Crea un nuovo Google Sheet, ad esempio "Dispensa DB".
2. Vai su **Estensioni → Apps Script**, cancella il contenuto e incolla `Code.gs`.
3. Cambia `TOKEN` con una parola segreta a tua scelta.
4. Seleziona la funzione `setup` e premi **Esegui** (autorizza l'accesso).
5. **Esegui il deployment → Nuovo deployment → App web**: esegui come *Me*, accesso *Chiunque*.
6. Copia l'URL che finisce con `/exec`.

## 2. Frontend (GitHub Pages, come per il bilancio)
1. Crea un nuovo repo, ad esempio `dispensa`.
2. Carica `index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png` e `icon-512.png`.
3. Vai su **Settings → Pages → Deploy from branch → main / root**.
4. Apri `https://<utente>.github.io/dispensa/` su iPhone, poi **Condividi → Aggiungi alla schermata Home**.

## 3. Primo avvio
- Inserisci il tuo nome, l'URL `/exec` e il token, poi premi **Collega**.
- Poi vai su ⚙︎ → **Invia link di configurazione** e mandalo ad Alba via WhatsApp. Lei apre il link, aggiunge l'app alla Home e incolla lo stesso link nel campo URL: token e URL si compilano da soli.

## Uso
| Azione | Come |
|---|---|
| Check-out veloce | ▥ in modalità **− Usa**: inquadri e scala 1, e lo scanner resta aperto per il prossimo prodotto |
| Rientro dalla spesa | ▥ in modalità **+ Carica**: ogni scansione aggiunge 1 |
| Prodotto nuovo | Si apre subito il form, già compilato da Open Food Facts. Completi solo i campi evidenziati |
| Al volo dalla lista | Tasti − / + su ogni riga |
| Lista spesa | Automatica quando la quantità scende sotto la **scorta minima**, e si può condividere su WhatsApp |

## Note
- Il foglio "Movimenti" registra lo storico: chi ha fatto cosa e quando.
- Funziona anche offline: le modifiche restano in coda e si sincronizzano appena torna la rete.
- Dopo ogni modifica a `Code.gs` fai: **Gestisci deployment → modifica → Nuova versione**, così l'URL resta lo stesso.
- Su iPhone la fotocamera può richiedere il permesso a ogni avvio dell'app dalla Home. È un limite di iOS.
