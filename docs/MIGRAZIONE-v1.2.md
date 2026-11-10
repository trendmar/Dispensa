# Migrazione a Dispensa v1.2

Procedura passo per passo, pensata per **non alterare i dati esistenti** (spec §6). Regole:

- Prova **sempre prima sulla copia** del foglio. L'originale si tocca solo dopo che la copia ha funzionato.
- Se un passo non dà l'esito atteso: **fermati** e non proseguire.
- Il token non va mai scritto in chat, in file del repository o in messaggi.

## Avvertenze sulle Proprietà script

- Le proprietà sono più d'una: **Aggiungi proprietà script** aggiunge una riga; compila tutte le righe e salva **una volta**. **Non cancellare mai `TOKEN`**: senza, il backend rifiuta ogni richiesta (telefoni e Home Assistant compresi). Imposta `TOKEN` **prima** di incollare il nuovo codice.
- `catScad` contiene **nomi di categoria** (Latticini, Colazione…), non posizioni (Dispensa, Frigo…), scritti identici alla colonna `categoria`, in **JSON con virgolette doppie dritte**: `["Latticini","Carne e pesce"]`. Senza virgolette o con virgolette tipografiche il valore non è JSON valido e viene trattato come lista vuota, senza errori. In esercizio la lista si imposta dall'app (Impostazioni → Scadenze per categoria), non a mano.

## Prima di cominciare

| Cosa | Dove |
|---|---|
| Token attuale | riga `const TOKEN = '…'` del `Code.gs` in uso; è il valore che hanno i telefoni e Home Assistant |
| Codice nuovo | `backend/Code.gs` (contiene solo il segnaposto `CAMBIA-QUESTO-TOKEN`) |

## Passi

| # | Dove | Cosa fai | Cosa devi vedere | Se non lo vedi |
|---|---|---|---|---|
| 0 | Google Sheet | **File → Crea una copia**, nome "Dispensa TEST" | Una copia con Prodotti, Spesa, Movimenti | — |
| 1 | Apps Script della copia → ⚙︎ Impostazioni progetto → Proprietà script | Aggiungi `TOKEN` con il valore **attuale** del token | La proprietà è elencata | Non incollare il codice finché non c'è |
| 2 | Editor | Sostituisci tutto `Code.gs` con il nuovo, salva; esegui `auditDb` | Scheda `Audit` con la sola intestazione (nessuna anomalia) | Mandami il contenuto della scheda |
| 3 | Editor | Esegui `snapshot`, poi `setup` (autorizza i permessi) | Fogli `_bak_AAAAMMGG_HHmm_Prodotti` e `_Spesa`; in `Prodotti` la cella **P1 = `lotti`**, tutte le altre celle uguali a prima; due trigger (orologio a sinistra): `pulisciStorico` e `snapshot` | Se `setup` si ferma con un errore, **non ha scritto nulla**: leggi il messaggio e dimmelo |
| 4 | Distribuisci → Gestisci distribuzioni → ✎ → **Nuova versione** (per l'originale; mai "Nuova distribuzione") | L'app 1.1 sui telefoni continua a funzionare | Carico e scarico senza errori | Torna al codice precedente (vedi Rollback) |
| 5 | Originale | Ripeti 1-4 sull'**originale**; poi carica il frontend su GitHub e apri l'app due volte | Impostazioni: `App v1.2.0 · Backend v1.2.0` | — |
| 6 | App → Impostazioni → Scadenze per categoria | Attiva le categorie (anche "Attiva le tre categorie consigliate") | Le categorie scelte chiedono la scadenza al carico | — |

## Prova del backend sulla copia con l'app 1.1 (Checkpoint 1)

La copia non ha un indirizzo `/exec`: serve un deployment **di prova** (non tocca quello dei telefoni).

1. Sulla copia: **Distribuisci → Nuova distribuzione → ⚙︎ App web**, "Esegui come: me", "Chi ha accesso: chiunque", poi **Distribuisci**. Copia l'URL che finisce con `/exec`.
2. Apri `https://trendmar.github.io/Dispensa/` in una **finestra in incognito del computer** (non sui telefoni: lì c'è la configurazione vera). Inserisci nome, URL di prova e token, **Collega**.
3. Con la categoria `catScad` ancora vuota: su un prodotto tocca **+** e **−**. Atteso: nel foglio `Prodotti` cambia solo `qty` (e `updated`/`updatedBy`) di quel prodotto; `Movimenti` riceve una riga per tocco; la colonna `lotti` resta vuota.
4. Nelle Proprietà script della copia aggiungi `catScad` con valore `["Latticini"]`. Su un prodotto di categoria Latticini tocca **+** e poi **−**. Atteso: `lotti` si riempie con un JSON come `[{"d":"2026-11-10","q":3},{"d":"","q":1}]`, poi lo scarico toglie dal lotto con la data più vicina; `scadenza` mostra la data del primo lotto.
5. Riporta `catScad` a `[]` (o elimina la proprietà) e verifica che i tocchi tornino identici a prima.

## Prova su iPhone (Checkpoint 2 e 3)

Si prova su una **copia** del foglio e su un indirizzo HTTPS separato dal sito in uso (per la fotocamera serve HTTPS). Non usare mai l'indirizzo del foglio vero. Dopo ogni aggiornamento dell'app di prova chiudi del tutto Safari e riaprilo. In Impostazioni la riga in fondo deve dire `App v1.2.0 · Backend v1.2.0`, senza "Aggiornamento incompleto"; se il backend risulta 1.1, nel deployment manca *Nuova versione* (il numero `const VERSION` nel codice non basta: il deployment serve l'ultima versione pubblicata).

**Checkpoint 2: conferma visiva e sincronizzazione**
1. In modalità silenziosa, **+ Carica** e un codice di un prodotto presente: lampo verde a tutto schermo, messaggio `＋ Nome · 3 → 4`, indicatore accanto alla ✕ che torna a `✓`. ✅ provato.
2. **− Usa**: lampo corallo e `− Nome · 4 → 3`. Prodotto già a zero: lampo ambra e `già a 0`.
3. Codice tenuto fermo 3 secondi: **un solo** carico. Tolto e riinquadrato entro 2,5 secondi: lampo grigio e "Già letto".
4. Modo aereo: l'indicatore diventa `offline · N` e, tornata la rete, `✓`.
5. Dopo un +/− dalla lista la riga si evidenzia per 300 ms.
6. Un prodotto presente non deve mai aprire il modulo "Nuovo prodotto". Se succede, confronta il codice letto con quello nel foglio: una lettura sbagliata ma valida (EAN-13 con cifre diverse) è già gestita dalla lettura confermata.
7. Le schede (Impostazioni, prodotto) si chiudono trascinando la linguetta verso il basso.

**Checkpoint 3: scadenze per lotti**
1. Impostazioni → **Scadenze per categoria**: gli interruttori restano accesi dopo la chiusura. "Attiva le tre categorie consigliate" accende Latticini, Carne e pesce, Frutta e verdura.
2. **+ Carica** (scanner o tasto +) su un prodotto di una categoria attiva: l'unità è subito registrata senza data e compare il pannello **Scadenza?** con i lotti esistenti, `+7 g`, `+30 g`, `📅 Scegli`, `Senza data` e ✕. Il pannello **resta aperto** finché non scegli o tocchi ✕, anche con più unità (il contatore `×N` sale e una sola scelta le sposta tutte). Ogni carico successivo lo richiede di nuovo.
3. **📅 Scegli** apre una riga con il campo data e **Conferma**: muovere la rotella non cambia nulla finché non tocchi Conferma. Stessa cosa per il cambio data di un lotto nella scheda (📅, poi OK).
4. **− Usa** su un prodotto con più lotti: scarica dal lotto che scade prima (FEFO) con `scade 12/11 · poi 20/11`; compare la striscia `Tolto dal lotto 12/11 · Era un altro lotto?`. Toccando un altro lotto viene fatto **un solo** `lotMove`: quantità totale invariata.
5. Nel foglio, scheda `Prodotti`: `qty` = somma dei `q` della colonna `lotti`, `scadenza` = prima data non vuota dei lotti. Nessuna riga nuova in `Movimenti` per le correzioni di lotto.
6. Le date brevi mostrano l'anno (`gg/mm/aa`) solo se cadono oltre 300 giorni da oggi (o più di 60 giorni fa).

## Rollback (in quest'ordine)

1. Ripubblicare il `index.html` precedente (`git revert` del commit del frontend).
2. Riaprire l'app sui due telefoni e attendere la coda vuota (indicatore `✓`).
3. Eseguire `prepareRollback()` nell'editor: svuota la sola colonna `lotti` e riporta quanti prodotti c'erano.
4. Riportare il backend alla versione precedente (Gestisci distribuzioni → modifica → scegli la versione precedente).

Dopo il rollback `qty` e `scadenza` (prossima scadenza) sono coerenti; si perde solo il dettaglio dei lotti. Eventuali `lotMove`/`cfgSet` ancora in coda ricevono "op sconosciuta" dalla 1.1: è innocuo.

## Regole d'esercizio

- **Non scrivere righe a mano nel foglio**: ogni riga di `Prodotti` deve avere un `id` e viene inserita dall'app. `setup()` e `auditDb()` rilevano le righe senza `id`.
- I fogli `_bak_*` non si cancellano da soli: eliminali a mano quando non servono più.
