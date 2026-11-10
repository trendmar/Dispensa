# Dispensa: specifica rev. 1.2

| | |
|---|---|
| **Documento** | Specifica funzionale e tecnica per Claude Code |
| **Versione documento** | 1.1 (rivista dopo audit indipendente; da approvare) |
| **Data** | 2026-11-09 |
| **Committente** | Mario |
| **Baseline** | Dispensa v1.1: `index.html` e `sw.js` (repo `trendmar/Dispensa`), `Code.gs` v1.1 (346 righe), `dispensa_alexa.yaml` v1.1.1 (Home Assistant) |
| **Obiettivo di rilascio** | Dispensa v1.2.0 |

---

## 0. Come leggere e usare questo documento

- **Per Claude Code.** Leggi tutto prima di scrivere codice. Lavora per fasi (sezione 8.1) e **fermati a ogni checkpoint** per far validare il risultato a Mario. Non anticipare fasi successive.
- **Linguaggio normativo.** "Deve" e "non deve" sono obbligatori; "dovrebbe" è una raccomandazione forte; "può" è facoltativo. Ogni requisito ha un ID (R1.x, R2.x, R3.x, Qn) e una priorità: **P0** obbligatorio per il rilascio, **P1** da fare salvo motivazione scritta, **P2** facoltativo.
- **Principio di codice (vincolante).** Codice semplice e pulito: nessuna astrazione non richiesta, nessuna dipendenza nuova, funzioni piccole con nome chiaro, commenti solo dove il motivo non è ovvio. Se un requisito P1 o P2 complica sensibilmente il codice, va segnalato invece che implementato.
- **Input.** Mario fornisce `Code.gs`, `index.html`, `sw.js`, `dispensa_alexa.yaml` e `LEGGIMI.md` della v1.1. Il `Code.gs` del repository deve contenere solo il segnaposto `CAMBIA-QUESTO-TOKEN`: **non committare mai un token vero** (R3.7). Prima di toccare il codice, verifica che i file ricevuti corrispondano a questa specifica; se differiscono, vale il file ricevuto e le differenze vanno segnalate.
- **Cosa non è in questo documento.** README per GitHub e documento di studio sono consegnati a parte.

## 1. Obiettivi e ambito

| ID | Obiettivo |
|---|---|
| O1 | Gestire scadenze diverse per lo stesso codice a barre (lotti), attivabile **selettivamente per categoria**, senza peggiorare la facilità d'uso |
| O2 | Dare una conferma visiva immediata e inequivocabile di ogni check-in e check-out, mantenendo il messaggio testuale con quantità di partenza e di arrivo |
| O3 | **Non alterare in alcun modo i dati già presenti nel database** (Google Sheet già popolato dall'app) |
| O4 | Introdurre quick win di interfaccia e di affidabilità |

**Fuori ambito.** Cambio di database, framework o build step per il frontend; autenticazione per utente; lettura automatica delle date da fotocamera; notifiche push; modifiche alla logica di `alexaSync` e al package Home Assistant (devono continuare a funzionare invariati). **Rimandate alla 1.3:** sincronizzazione condizionale (`rev`) e scrittura per riga: con poche centinaia di righe il beneficio è piccolo, mentre toccano il cuore di lettura e scrittura.

**Contesto d'uso da preservare.** Due telefoni (iPhone, Safari, app aggiunta alla Home); funzionamento offline con coda; frontend a file singolo senza build; backend Apps Script con Google Sheet; hosting GitHub Pages dal ramo `main`, cartella radice; nessun costo aggiuntivo.

## 2. Stato attuale (baseline v1.1)

### 2.1 Componenti

| Componente | File | Note rilevanti |
|---|---|---|
| Frontend | `index.html` (745 righe, JS inline), `sw.js`, `manifest.webmanifest`, icone | Stato in `localStorage` (`disp.cfg`, `disp.items`, `disp.extras`, `disp.pend`, `disp.mode`). Libreria scanner `html5-qrcode@2.3.8` da unpkg |
| Backend | `Code.gs` | `doGet`, `doPost` (operazioni e `alexaSync`), lock di script, trigger mensile `pulisciStorico` |
| Dati | Google Sheet: `Prodotti`, `Spesa`, `Movimenti` | Scritti solo da `Code.gs`; righe inserite solo dall'app |
| Ponte Alexa | `dispensa_alexa.yaml` v1.1.1 | `POST` con `{action:'alexaSync', alexa:[...]}` ogni 15 minuti e al cambio della lista |

### 2.2 Schema dati

| Foglio | Colonne |
|---|---|
| `Prodotti` (15) | `id, barcode, nome, marca, formato, categoria, posizione, qty, scortaMin, scadenza, note, img, updated, updatedBy, stato` |
| `Spesa` (5) | `id, nome, stato, quando, utente` |
| `Movimenti` (7) | `quando, id, nome, op, delta, qtyDopo, utente` (**invariato nella 1.2**) |

Colonne di testo (`setNumberFormat('@')`): `id, barcode, scadenza, updated`. Date ISO `YYYY-MM-DD`.

### 2.3 Fatti del codice v1.1 che condizionano la 1.2

Verificati su `Code.gs` e `index.html` reali (numeri di riga: Appendice C).

1. **`COLS` è l'ordine delle colonne** e la lettura (`getRange(2,1,n,COLS.length)`) è posizionale: si può solo aggiungere in coda.
2. **`writeTable` riscrive tutte le righe** a ogni salvataggio, passando da `toItem`/`toObj` (`qty` e `scortaMin` → numero, `id` e `barcode` → testo, `Date` → stringa). **`openDb` scarta le righe con `id` vuoto** e `writeTable` le cancella. Poiché tutte le righe sono state scritte dall'app, il foglio è già nel punto fisso di questa conversione.
3. **`applyOp('upsert')` su prodotto esistente copia in blocco tutte le `COLS`** tranne `id, qty, updated, updatedBy, stato`, quando il campo è presente nell'item inviato (righe 160-162). L'app invia l'item intero ricevuto dal server (`{...it}`, `openForm`): una copia vecchia può quindi sovrascrivere campi modificati nel frattempo da un altro telefono.
4. **`delta` risponde `{ok, qty}`**; l'app non legge `results` (righe 266-268). Le operazioni sconosciute danno errore per operazione, senza far fallire la richiesta.
5. **Un solo `scadenza` per prodotto.** La modalità Carica fa solo `qty +1`.
6. **Feedback dello scanner debole.** Tre modalità (`out`, `in`, `ask`). `scanMsg` mostra solo la quantità finale; `navigator.vibrate` non esiste su iOS e il bip può essere silenziato. `html5-qrcode` richiama la funzione di lettura a ogni frame in cui decodifica (12 fps): la 1.1 funziona perché `onCode` scarta in silenzio le riletture dello stesso codice entro 2,5 s (riga 615). `#sync` sta nell'header ed è **coperto dallo scanner** (`#scan` a schermo intero).
7. **Nessun timeout** su `apiGet`/`apiPost`: una `fetch` appesa lascia `syncing = true` fino al riavvio. Il server, d'altra parte, può attendere fino a 20 s il lock (`waitLock(20000)`).
8. **Le operazioni non sono idempotenti.** Se la risposta si perde dopo che il server ha scritto, l'app rimanda il blocco e un `delta` si applica due volte.
9. **Token costante in `Code.gs`** (riga 15); ogni aggiornamento del file obbliga a reinserirlo.
10. **Service worker** network-first con `html5-qrcode` caricato da unpkg: lo scanner dipende da un server terzo al primo avvio.
11. **`saveDb` scrive prima `Prodotti` e poi `Movimenti`.** Un errore nella scrittura dei log, dopo quella dei prodotti, fa fallire la richiesta e l'app rimanda operazioni già applicate.
12. **Documentazione e YAML.** Il YAML in produzione è la v1.1.1 (15 minuti, trigger di stato, condizione di disponibilità). `LEGGIMI.md` e lo zip v1.1 riportano la versione precedente (5 minuti): sono **datati**. Mancano la codifica dei caratteri speciali del token nell'URL e il primo giro di importazione della lista Alexa. Comportamento verificato: un prodotto spuntato su Alexa passa a "nel carrello" (`stato='preso'`); una voce libera spuntata viene **rimossa**. Il nome reale dell'entità `todo.*` contiene l'indirizzo email di Mario: nel repository pubblico va usato il segnaposto `todo.alexa_shopping_list`.

## 3. Principi vincolanti

| ID | Principio |
|---|---|
| P-1 | **Integrità dei dati prima di tutto.** Modifiche solo additive, migrazione pigra (R3) |
| P-2 | **Compatibilità in entrambe le direzioni** tra app e backend, per rilasciarli e annullarli separatamente (6.3) |
| P-3 | **Zero attrito dove non serve.** Al massimo 1 tap in più, solo per categorie con scadenza attiva; lo scanner non si blocca mai |
| P-4 | **Offline-first invariato.** Operazioni in coda, per differenza, inviate nell'ordine di creazione |
| P-5 | **Un solo algoritmo.** La logica dei lotti sta in `lib/lots.js` (Appendice B). Le copie in `Code.gs` e `index.html` sono delimitate da marcatori `// BEGIN lots.js` / `// END lots.js` e un test verifica che siano identiche al file |
| P-6 | **Nessun segreto nel repository** |
| P-7 | **Test prima del rilascio**, rilascio a fasi, rollback documentato |

---

## 4. R1: scadenze per lotti, attivabili per categoria

### 4.1 Comportamento

| Azione | Categoria **senza** scadenza attiva (come oggi) | Categoria **con** scadenza attiva |
|---|---|---|
| + Carica (scanner, tasto +, scheda) | `qty +1`, nessun tap in più | `qty +1` nel lotto "senza data", poi pannello **Scadenza?** (R1.9) |
| − Usa | `qty −1` | `qty −1` dal lotto che **scade prima** (FEFO); il messaggio indica il lotto consumato |
| Campo `scadenza` | Unica, facoltativa, modificabile a mano | **Derivato**: prossima scadenza tra i lotti |
| Tag e filtro "In scadenza" | Su `scadenza` | Sul lotto più vicino |
| Scheda prodotto | Come oggi | Elenco lotti, modificabile |

Una categoria è "con scadenza attiva" se il suo nome compare **esattamente** (confronto di stringhe) in `catScad` (R1.2). Per un prodotto, vale la categoria **dopo** l'operazione in corso.

### 4.2 Modello dati (solo aggiunte in coda)

**R1.1 (P0): colonna `lotti` in `Prodotti`.** Nuova colonna 16, `lotti`, formato testo. Array JSON ordinato per data, lotti senza data in coda:

```json
[{"d":"2026-11-12","q":2},{"d":"2026-11-20","q":4},{"d":"","q":1}]
```

`d` è `YYYY-MM-DD` oppure stringa vuota (senza data); `q` è un intero maggiore di 0. Una `d` non conforme a `^\d{4}-\d{2}-\d{2}$` viene trattata come vuota. Invariante, per i prodotti con scadenza attiva: **somma dei `q` = `qty`**. Un array vuoto si scrive come cella vuota. `lotti` si aggiunge a `COLS` in coda, così lettura e scrittura restano allineate.

**R1.2 (P0): configurazione in Script Properties.** La proprietà `catScad` contiene un array JSON di nomi di categoria. **Valore iniziale: `[]`** (nessuna categoria attiva: il backend 1.2 si comporta come la 1.1 finché Mario non attiva qualcosa). `doGet` e `doPost` restituiscono `config: { catScad: [...] }`. È lo stato **condiviso tra i telefoni**. Se la proprietà manca o non è valida si usa `[]`. Nessun nuovo foglio.

**R1.3 (P0): lotti virtuali e riconciliazione.** Il backend non converte in blocco i prodotti esistenti. Per un prodotto con scadenza attiva e `lotti` vuota, i lotti effettivi si **calcolano in lettura**: un lotto `{d: scadenza, q: qty}` se `qty > 0` (`d` vuota se la scadenza manca), nessun lotto se `qty = 0`. Se `lotti` è valorizzata ma la somma non coincide con `qty` (ad esempio dopo aver spento e riacceso la categoria con quantità modificate), si **riconcilia in memoria**: per difetto si aggiunge la differenza al lotto senza data, per eccesso si tolgono unità dal lotto che scade prima. I lotti calcolati vengono scritti nel foglio **solo quando il prodotto è toccato da un'operazione**. Un `delta` con valore 0 conta come tocco. Funzioni: `effectiveLots`, `reconcile` (Appendice B).

*(Nella 1.2 la tabella `Movimenti` resta invariata: l'app non legge lo storico e aggiungere una colonna comporterebbe modifiche a `log()` e rischi sulla scrittura. Il lotto toccato compare solo nel messaggio a schermo.)*

### 4.3 Protocollo

**R1.4 (P0): operazioni.** Contratto e esempio calcolato in Appendice A.

| Operazione | Parametri | Semantica per prodotto con scadenza attiva |
|---|---|---|
| `delta` (esteso) | `id`, `delta`, `lot?` | `delta > 0`: aggiunge al lotto `lot` (assente o non ISO = senza data). `delta < 0` senza `lot`: consumo **FEFO**. `delta < 0` con `lot`: consuma da quel lotto, e l'eventuale residuo (lotto insufficiente o inesistente) in FEFO: il totale scalato è sempre rispettato. Risposta invariata: `{ok, qty}` |
| `lotMove` (nuova) | `id`, `from`, `to`, `q` | Sposta fino a `q` unità dal lotto `from` al lotto `to` (li unisce se esiste). Sposta al massimo ciò che c'è; `qty` non cambia. Non scrive su `Movimenti` |
| `cfgSet` (nuova) | `key`, `value` | Imposta una proprietà di configurazione (oggi solo `catScad`, array di stringhe; altro valore → errore per operazione). Ultima scrittura vince |
| `upsert` | come v1.1, con le regole sotto | La variazione di quantità segue le regole di `delta` senza `lot` |

**Regole di `upsert` (R1.4a, P0).** Nel ciclo che copia i campi su un prodotto **esistente**:
- `lotti` **non viene mai copiata** dall'item del client, per nessuna categoria;
- `scadenza` non viene copiata se la categoria (dopo l'aggiornamento) è attiva: è derivata;
- per un prodotto **nuovo**, `lotti` del client è ignorata: con categoria attiva il primo lotto nasce da `qty` e `scadenza`.

Motivo: l'app rimanda l'item intero ricevuto in precedenza; una copia vecchia non deve sovrascrivere lotti modificati da un altro telefono.

Per i prodotti **senza** scadenza attiva ogni operazione si comporta esattamente come in v1.1 e `lotti` non viene toccata.

**R1.5 (P0): il server decide la distribuzione.** I consumi FEFO sono calcolati dal server sullo stato corrente; l'app applica lo stesso algoritmo in modo ottimistico sul proprio stato locale. Nessuna operazione trasporta quantità assolute dei lotti. Il totale resta coerente con `qty`; la ripartizione tra lotti può dipendere dall'ordine di arrivo, ed è accettabile.

**R1.6 (P0): `scadenza` derivata.** Quando un'operazione tocca un prodotto con scadenza attiva, il server riscrive `scadenza` con la prima data non vuota tra i lotti (vuota se non ce ne sono). Il foglio resta leggibile, `alexaSync` e le app 1.1 continuano a funzionare.

**R1.7 (P0): validazione delle date.** Le date `d`, `lot`, `from`, `to` vengono accettate solo se `YYYY-MM-DD`; altrimenti valgono "senza data" (`isoOrEmpty`, Appendice B). Nessun parser di formati digitati a mano: le righe sono scritte dall'app.

### 4.4 Interfaccia

**R1.8 (P0): stato persistente di versione e configurazione.** L'app salva in `localStorage` (`LS.srv = 'disp.srv'`) `{version, config}` a ogni risposta del backend e li usa all'avvio anche offline. Una modifica di `catScad` fatta dall'interfaccia viene applicata subito in locale e inviata con `cfgSet`.

**R1.9 (P0): pannello "Scadenza?" dopo ogni carico di un prodotto con scadenza attiva.**
- Nello scanner: elemento `position:absolute` dentro `#scan`, ancorato sopra la barra inferiore (`bottom` = altezza di `.foot` più area sicura), **senza inserirsi nel flusso flex** (altrimenti `#reader` si ridimensiona e il riquadro di lettura calcolato a `start()` non coincide più). Per i tasti + in lista e scheda: un unico componente fisso `#lotbar`, sopra le schede (`z-index` maggiore di quello impostato dall'osservatore delle schede) e sotto il toast, `bottom` = barra di navigazione più area sicura.
- L'unità è **già registrata** al momento del tocco o della scansione, nel lotto senza data (`delta` senza `lot`). Il pannello tiene un contatore `n` delle unità dello **stesso prodotto** caricate da quando è comparso, e **azzera il timer a ogni scansione**. Ogni scelta invia **un solo** `lotMove` con `q = n` dal lotto senza data al lotto scelto.
- Scelte rapide: **[Stessa: gg/mm]** (ultima data usata per quel prodotto, in `localStorage` con chiave `disp.lastExp`, al massimo 200 prodotti; se manca, la data più alta tra i lotti), **[+7 g]**, **[+30 g]** (costante `QUICK_DAYS`), **[📅 Scegli]** (apre una riga con il campo data nativo e il pulsante **Conferma**: il lotto si sceglie solo con Conferma, mai sull'evento `change`, che il selettore a rotella di iOS invia a ogni scatto), **[Senza data]**.
- **Resta aperto finché l'utente non sceglie o tocca ✕** (rev. dopo la prova su iPhone: il timeout di 8 s era troppo breve e distruggeva il selettore data); chiudendo con ✕ le unità restano senza data e nessuna scelta viene registrata. Offre come scelte i lotti esistenti (data · ×q), le date rapide, il selettore e "Senza data". Una scansione di un **altro** prodotto lo sostituisce. Per 20 s dal tocco su **📅 Scegli** `onCode` ignora le letture (iOS non invia focus/blur sul campo data). Chiudere la scheda prodotto chiude il pannello.
- **Nessun lotto ereditato (rev. dopo la prova su iPhone):** ogni carico di un prodotto con scadenza attiva, da scanner o da tasto +, chiede il lotto. Se il pannello è già aperto per quel prodotto il contatore `n` sale e una sola scelta sposta tutte le unità; dopo una scelta o una chiusura con ✕, il carico successivo lo riapre. Il messaggio dello scanner è `＋ Nome · 3 → 4 · scegli la scadenza`.
- Non mette in pausa la fotocamera. Nella modalità **Chiedi** (apre la scheda prodotto) il pannello non compare: i lotti si gestiscono dalla scheda (R1.11).

**R1.10 (P0): consumo (− Usa).** Nessun tap in più. Messaggio: `− Yogurt greco · 4 → 3 · scade 12/11`, dove la data è quella del lotto consumato; se il prossimo lotto è diverso, accodare ` · poi 20/11`.

**R1.11 (P0): scheda prodotto.** Per i prodotti con scadenza attiva, sezione **Lotti**: una riga per lotto con data, quantità e −/+ propri (`delta` con `lot`); **＋ Aggiungi lotto** (data e quantità: `delta` con `lot`); modifica data di un lotto (📅 apre la riga con il campo data, **OK** conferma con `lotMove` con `q` pari alla quantità del lotto). Il lotto senza data compare come "senza data ×n".

**R1.12 (P0): form Nuovo e Modifica.**
- Prodotto **nuovo** con scadenza attiva: il campo Scadenza resta (evidenziato se vuoto, come oggi) e crea il primo lotto con la quantità iniziale.
- Prodotto **esistente** con scadenza attiva: il campo Scadenza è sostituito da una riga di sola lettura "Prossima scadenza: gg/mm, N lotti. Gestisci i lotti nella scheda".
- Prodotto senza scadenza attiva: invariato.
- Cambiare categoria nel form non altera i lotti; cambia solo il comportamento da quel momento.
- Aumentare la quantità nel form aggiunge unità senza data; diminuirla consuma FEFO. Dopo il salvataggio il pannello **non** compare.

**R1.13 (P0): elenco e filtri.**
- `expiry(it)`: prodotti con scadenza attiva → prossima data tra i lotti effettivi con quantità > 0; altrimenti `it.scadenza`.
- Tag, filtro "In scadenza" e ordinamento usano `expiry(it)`. Con più lotti, se il lotto più vicino è inferiore al totale, il tag aggiunge la quantità del lotto: `scade tra 3 gg · ×2`.
- **P1:** chip **"Da datare"**, visibile solo se esiste almeno un prodotto con scadenza attiva la cui colonna `lotti` è valorizzata e contiene un lotto senza data con `q > 0`. I lotti virtuali dei prodotti non ancora toccati **non** vi compaiono.

**R1.14 (P0): Impostazioni, sezione "Scadenze per categoria".** Un interruttore per ciascuna categoria (`DEF_CAT` più le categorie personalizzate presenti nei prodotti) e un pulsante **"Attiva le tre categorie consigliate"** (Latticini, Carne e pesce, Frutta e verdura). Testo guida: "Attivo: ogni carico chiede la scadenza e il consumo parte dal lotto più vicino. Spento: scadenza unica facoltativa, come prima." Il salvataggio invia `cfgSet`. Spegnere una categoria **non cancella** i lotti: restano nel foglio, ignorati finché la categoria non viene riaccesa (poi si riconcilia, R1.3).

**R1.15 (P0): gating.** L'app abilita le funzioni dei lotti solo se la risposta del backend (o `LS.srv`) ha `version` maggiore o uguale a 1.2, **confrontata numericamente per componenti** (non come stringa: `'1.10' < '1.2'`), **e** contiene l'oggetto `config`. Un `catScad` vuoto **non** disabilita nulla: l'interfaccia di Impostazioni resta disponibile per attivare le categorie. Se la condizione non è soddisfatta, l'app si comporta come la 1.1 e non invia `lotMove` né `cfgSet`.

**R1.16 (P1): export CSV** include la colonna `lotti`.

### 4.5 Casi limite

| Caso | Comportamento atteso |
|---|---|
| Categoria attiva, `qty > 0`, `scadenza` valorizzata, `lotti` vuota | Lotto virtuale con quella data; nessuna scrittura finché non viene toccato |
| Come sopra, senza `scadenza` | Lotto virtuale senza data |
| `qty = 0` | Nessun lotto; `scadenza` derivata vuota alla prossima scrittura |
| Scarico oltre la giacenza | Si ferma a 0, nessun errore (come v1.1) |
| Due telefoni scaricano insieme lo stesso prodotto | Entrambi FEFO sul server, sotto lock; somma lotti = `qty` |
| Carico offline con data scelta | In coda: `delta` senza `lot`, poi `lotMove` (un solo meccanismo); l'ordine di invio è preservato. `delta` con `lot` solo dalla sezione Lotti della scheda |
| Categoria spenta, quantità modificata, poi riaccesa | Riconciliazione (R1.3) |
| Prodotto passa da categoria senza a categoria con scadenza | Lotto virtuale dalla `scadenza` esistente |
| Data nel passato | Ammessa; il lotto compare come scaduto |
| `lotti` non è JSON valido o non è un array | Trattata come vuota (si ricade sul lotto virtuale), segnalata da `auditDb()`; mai bloccante |
| `upsert` solo del nome su prodotto con categoria attiva | È un tocco: `lotti` viene materializzata (R1.3) |
| Lotto con `q = 0` | Rimosso |
| Eliminazione del prodotto | I lotti spariscono con la riga |
| `alexaSync`, scorta minima, lista spesa | Invariati: leggono `nome`, `qty`, `stato`, `scortaMin` |

### 4.6 Criteri di accettazione R1

- [ ] **Dati esistenti:** sulla copia del foglio reale, dopo aver eseguito `setup()` e attivato una categoria, la tabella `Prodotti` letta dal backend 1.2 è identica a quella letta dal backend 1.1 finché non si toccano prodotti (test golden 6.5).
- [ ] Carico dello stesso codice con due date diverse produce due lotti; − Usa consuma prima la data più vicina; il totale resta corretto.
- [ ] Il caricamento di 6 unità dello stesso prodotto chiede la data **una volta**, sia scansionandole tutte prima di scegliere (un solo `lotMove` con `q = 6`), sia scegliendo dopo la prima (le altre ereditano).
- [ ] Con `catScad = []` carico e scarico sono identici alla v1.1 (stessi tap, stesse righe in `Movimenti`).
- [ ] Un'app 1.1 collegata al backend 1.2 continua a caricare e scaricare senza errori, e un `upsert` 1.1 con `lotti` o `scadenza` vecchie non altera i lotti.
- [ ] `node test/run.js` passa: logica dei lotti (con PRNG a seme fisso), identità delle copie di `lots.js`, test su `applyOp`, test golden.

---

## 5. R2: conferma visiva di check-in e check-out

### 5.1 Requisiti

**R2.1 (P0): messaggio persistente con quota di partenza e di arrivo.** Il testo in fondo allo scanner resta fino alla scansione successiva e diventa più leggibile: 16 px, grassetto, colore coerente con l'esito. Formato: `{glifo} {nome} · {da} → {a}` più eventuali informazioni (lotto, "in lista spesa").

| Esito | Esempio di messaggio |
|---|---|
| Carico | `＋ Yogurt greco · 3 → 4` |
| Scarico | `− Yogurt greco · 4 → 3 · scade 12/11` |
| Scarico sotto scorta | `− Latte · 2 → 1 · in lista spesa` |
| Già a zero | `⚠︎ Latte · già a 0` |
| Nuova lettura ravvicinata dello stesso codice | `Già letto, attendi un attimo` |

**R2.2 (P0): flash visivo a schermo.** A ogni esito, entro 50 ms dalla lettura e **prima** di qualsiasi operazione asincrona, uno strato `#flash` dentro `#scan`, sopra l'inquadratura, mostra per 350 ms una cornice luminosa interna, un velo colorato e un glifo grande al centro che si ingrandisce e svanisce. Deve essere percepibile con la coda dell'occhio mentre si inquadra un codice.

| Esito | Colore | Glifo |
|---|---|---|
| Carico riuscito | verde `#4cc18a` | ＋ |
| Scarico riuscito | corallo `#f2827a` | − |
| Avviso (già a 0) | ambra `#f0a35c` | ! |
| Lettura ravvicinata ignorata | grigio `#9aa19d` | ⟲ |
| Prodotto nuovo | nessun flash: si apre il form | |

**Lettura confermata (R2.2b, P0; aggiunta dopo la prova su iPhone).** Il decoder può restituire, di rado, un EAN-13 con cifre sbagliate ma checksum valido (caso reale: SMAC sgrassatore `8003650025968` letto `6005650085968`, che ha creato un prodotto doppio). Un codice proveniente dalla fotocamera vale solo se decodificato **due volte uguale di seguito entro 1,5 s** (`confirmRead`, `CONFIRM_MS`); una decodifica isolata o diversa dalla precedente viene scartata. La digitazione manuale non è soggetta alla conferma.

**Doppia lettura (R2.2a, P0).** Poiché la libreria richiama la funzione a ogni frame, si traccia `lastSeenAt`, aggiornato a **ogni** callback per lo stesso codice. Finché il codice resta inquadrato senza interruzioni (callback a meno di 700 ms l'uno dall'altro) le riletture si scartano **in silenzio**, come oggi, senza flash e senza toccare il messaggio. Il feedback grigio e il messaggio `Già letto` compaiono solo se lo stesso codice **ricompare** dopo almeno 700 ms di assenza ed entro 2,5 s dall'ultima operazione registrata (`lastAt`).

**Vincoli.** `pointer-events: none`; non mette in pausa la fotocamera; si riavvia pulito a scansioni ravvicinate (rimuovere la classe, forzare il reflow, riaggiungerla); `@keyframes` CSS; con `prefers-reduced-motion: reduce` niente ingrandimento, solo dissolvenza di 250 ms con la cornice. Il colore **non** è l'unico segnale: glifo e testo restano sempre.

**R2.3 (P0): indicatore di sincronizzazione dentro lo scanner.** Nella barra superiore dello scanner, accanto alla ✕: `✓` (tutto sincronizzato), `⟳` (in corso), `· N` (N operazioni in attesa di invio), `⚠︎ N` (errore con N operazioni in coda), `offline · N` se `navigator.onLine` è falso. Il flash conferma che l'operazione è registrata sul telefono, l'indicatore che è arrivata al foglio.

**R2.4 (P0): segnale anche sui tasti −/+ in lista e scheda.** Evidenziazione della riga per 300 ms con la stessa palette e breve "salto" del numero. `render()` rigenera tutta la lista con `innerHTML`: l'evidenziazione si applica **dopo** `changeQty`, cercando l'elemento `[data-id]` nel DOM nuovo. Stessa regola `prefers-reduced-motion`. Con lo scanner aperto `queue()` **non** deve chiamare `render()` (la lista è nascosta): si ridisegna alla chiusura.

**R2.5 (P0): accessibilità.** `#scan-msg` con `aria-live="polite"`. Contrasto del testo sul nero ≥ 4,5:1.

**R2.6 (P0): suono e vibrazione restano**, ma non sono più canale di conferma: su iOS non esiste `navigator.vibrate` e il bip può essere silenziato.

### 5.2 Criteri di accettazione R2

- [ ] Ogni scansione riuscita produce flash e messaggio con `da → a` corretti, uguali a quelli visibili in lista.
- [ ] Tenendo lo stesso codice inquadrato per 3 s si ottiene **un** carico, un solo flash e il messaggio resta quello dell'operazione. Togliendo il codice per un secondo e riinquadrandolo entro 2,5 s si ottiene il flash grigio e `Già letto`.
- [ ] Con l'iPhone in modalità silenziosa il flash è visibile a un metro di distanza (verifica manuale).
- [ ] L'indicatore passa a `offline · N` senza rete e torna a `✓` alla ripresa con la coda vuota.
- [ ] 10 scansioni di codici diversi in 10 secondi non lasciano animazioni sovrapposte o bloccate.

---

## 6. R3: integrità dei dati e migrazione

### 6.1 Garanzie (tutte P0)

| ID | Garanzia |
|---|---|
| R3.1 | `setup()` e il rilascio v1.2 **non modificano, spostano o cancellano** alcuna riga o valore esistente. Aggiungono soltanto: intestazione `lotti` (`Prodotti`, colonna 16), formato testo della sola colonna 16, e (con `snapshot()`) fogli `_bak_*` |
| R3.2 | Le colonne esistenti mantengono nome, posizione e significato. Le nuove stanno **solo in coda** |
| R3.3 | `setup()` non esegue `setValues` su righe di dati. **Si ferma** (senza modificare nulla) se: l'intestazione `P1` non è vuota né `lotti`; `Prodotti` ha meno di 16 colonne e non può espanderle senza perdere dati; esistono righe di `Prodotti` con `id` vuoto ma altre celle valorizzate; la proprietà `TOKEN` manca (Q6) |
| R3.4 | **Per i prodotti non toccati, la riga scritta dalla 1.2 è identica a quella che scriverebbe la 1.1** (stessi `toItem` e `writeTable`), con `lotti` riscritta tal quale come letta. I lotti virtuali e riconciliati non vengono mai persistiti per prodotti non toccati. *(Con la scrittura per riga rimandata alla 1.3 il backend continua a riscrivere tutta la tabella; la garanzia riguarda il valore, non l'assenza di scrittura.)* |
| R3.5 | Compatibilità app/backend (matrice 6.3) |
| R3.6 | Nessuna riga senza `id` deve esistere al momento dell'aggiornamento: `auditDb()` e `setup()` le rilevano e si fermano. In esercizio il rischio residuo (riga scritta a mano senza `id`) è documentato nel README: non scrivere righe a mano |
| R3.7 | Nessun segreto nel repository: il `Code.gs` committato contiene solo il segnaposto; il YAML usa `!secret` e il segnaposto dell'entità |
| R3.8 | I formati di testo delle colonne esistenti (`id`, `barcode` con zeri iniziali, `scadenza`, `updated`) sono preservati |

### 6.2 Procedura di migrazione

| Passo | Chi | Azione | Esito atteso |
|---|---|---|---|
| 0 | Mario | File → Crea una copia del Google Sheet. Prova tutto sulla copia | Copia di prova; originale intatto |
| 1 | Mario | Impostazioni progetto → Proprietà script → aggiunge `TOKEN` con il **valore attuale** del token | La proprietà esiste; il vecchio codice continua a funzionare |
| 2 | Mario | Sulla copia: incolla il nuovo `Code.gs`, esegue `auditDb()` (sola lettura) | Report di anomalie (6.4); nessuna modifica ai dati |
| 3 | Mario | Corregge ciò che serve dal report; poi esegue `snapshot()` e `setup()` | Fogli `_bak_*`, intestazione `lotti`, trigger mensile ricreato |
| 4 | Mario | Gestisci deployment → modifica → **Nuova versione** (mai "Nuovo deployment") | L'app 1.1 continua a funzionare (verifica) |
| 5 | Mario | Ripete 2-4 sull'originale. Carica il nuovo frontend su GitHub, riapre l'app due volte | Impostazioni: `App v1.2.0 · Backend v1.2.0` |
| 6 | Mario | In Impostazioni → Scadenze per categoria, attiva le categorie (anche con "Attiva le tre categorie consigliate") | Le categorie scelte iniziano a chiedere la scadenza |

**Rollback, in quest'ordine.** (1) Ripubblicare il `index.html` precedente (`git revert`); (2) riaprire l'app sui due telefoni e attendere la coda vuota (`✓`); (3) eseguire `prepareRollback()`, che svuota la sola colonna `lotti` e riporta il numero di prodotti coinvolti; (4) riportare il backend alla versione precedente (Gestisci deployment → modifica). Motivo di `prepareRollback()`: la v1.1 riscrive solo 15 colonne e, dopo un'eliminazione, sposterebbe le righe lasciando la colonna 16 disallineata. Dopo il rollback `qty` e `scadenza` (prossima scadenza) sono coerenti; si perde solo il dettaglio dei lotti. Eventuali `lotMove`/`cfgSet` ancora in coda ricevono `op sconosciuta` dalla 1.1: innocuo.

### 6.3 Matrice di compatibilità

| | Backend 1.1 | Backend 1.2 |
|---|---|---|
| **App 1.1** | Situazione attuale | Funziona. Con `catScad = []` identica alla 1.1. Con categorie attive, `delta` senza `lot` va in "senza data" (carico) o FEFO (scarico); `scadenza` e `lotti` dell'item inviato da `upsert` sono ignorate; `config` ignorata |
| **App 1.2** | Funziona come 1.1: manca `config`, quindi nessuna funzione dei lotti, nessuna nuova operazione (R1.15) | Piena funzionalità |

### 6.4 Strumenti in `Code.gs`

| Funzione | Scopo | Modifica dati |
|---|---|---|
| `auditDb()` | Report di anomalie in un foglio `Audit` (o nel log): righe senza id, id duplicati, barcode duplicati, `qty` o `scortaMin` non numerici, `nome` numerico, date non ISO, `lotti` non valida o con somma diversa da `qty` | No (scrive solo `Audit`) |
| `snapshot()` | Copia `Prodotti` e `Spesa` in `_bak_AAAAMMGG_HHmm_Prodotti` e `_Spesa`. **Non cancella mai nulla**: i backup si eliminano a mano | No (aggiunge fogli) |
| `prepareRollback()` | Vedi 6.2 | Svuota solo la colonna `lotti` |

### 6.5 Test sui dati

- **Fixture** anonimizzata con: prodotti con e senza scadenza, barcode con zero iniziale, `qty` e `scortaMin` numerici, celle vuote intermedie. **Va generata passando i dati una volta dal `toItem`/`writeTable` della 1.1**, cioè nel punto fisso che il foglio reale ha già raggiunto, e non da dati grezzi diversi.
- **Test golden:** eseguire il `setup()` 1.2 simulato e una serie di operazioni sui prodotti A e B; confrontare cella per cella le righe degli altri prodotti, che devono coincidere con le righe scritte dalla 1.1 nelle stesse condizioni (R3.4).
- **Compatibilità:** stesse sequenze con payload 1.1 (senza `lot`, `opId`), incluso `upsert` con `lotti` e `scadenza` vecchie.
- **Harness semplice:** `applyOp(db, op)` lavora già sul `db` in memoria. I test caricano `Code.gs` in Node con `vm` e stub minimi (`SpreadsheetApp`, `PropertiesService`, `CacheService`, `LockService`, `Session`, `Utilities`, `ContentService`), costruiscono `db = {items, extras, logs, ...}` da righe di fixture e verificano `applyOp`, `openDb`/`saveDb` su un foglio finto minimale. Nessun framework.

---

## 7. R4: quick win

| ID | Intervento | Beneficio | Sforzo | Rischio | Prio |
|---|---|---|---|---|---|
| Q1 | Versione visibile e coerente (app e backend) | Si vede subito un aggiornamento fatto a metà | S | Basso | P0 |
| Q2 | Timeout di 45 s e recupero della sincronizzazione | Elimina il blocco "⟳ per sempre" | S | Basso | P0 |
| Q7 | Idempotenza delle operazioni (`opId`) | Niente doppi carichi se la risposta si perde o il timeout scatta | S | Basso | **P0** (insieme a Q2) |
| Q6 | Token solo in Script Properties | Gli aggiornamenti non richiedono più di reinserirlo; `Code.gs` pubblicabile | S | Basso | P1 |
| Q12 | Documentazione allineata al comportamento reale | Meno errori in fase di setup | S | Basso | P0 |
| Q3 | Libreria scanner locale e precache | Scanner offline e al primo avvio | S | Basso | P1 |
| Q4 | Sincronizzazione raggruppata durante la scansione | Meno richieste e meno contesa sul lock | S | Basso | P1 |
| Q9 | `snapshot()` settimanale a trigger | Ripristino semplice | S | Basso | P2 |
| Q10 | Una riga `console.log` per richiesta (operazioni, millisecondi) | Diagnosi in Esecuzioni | S | Basso | P2 |

Tolte rispetto alla bozza 1.0: annulla ultima operazione (non ripristina lo stato lista spesa; correggere costa un tap), `Movimenti.lotto`, `repairIds()`, foglio `Config`. Rimandate alla 1.3: sincronizzazione condizionale (`rev`) e scrittura per riga.

**Q1.** `VERSION = '1.2.0'` in `index.html` e `Code.gs`, cache di `sw.js` a `dispensa-v1.2`. In Impostazioni: `App vX · Backend vY` (il backend restituisce già `version`). Se differiscono, riga di avviso "Aggiornamento incompleto: pubblica la nuova versione del backend o riapri l'app".

**Q2.** `fetchJson(url, opts, ms = 45000)` con `AbortController`, usato da `apiGet` e `apiPost`; `syncing = false` in un blocco `finally`. Il valore 45 s è superiore all'attesa massima del lock (20 s) più il tempo di scrittura, ed è lo stesso `timeout` del YAML. In caso di errore con coda non vuota, nuovo tentativo dopo 30 s finché l'app è visibile, oltre ai trigger già presenti (`visibilitychange`, `online`, nuova operazione). **Q2 non va rilasciata senza Q7.** Attenzione: `sync()` invia `pending.slice()` e poi rimuove i primi `batch.length` elementi (righe 264-267): non modificare operazioni già in volo.

**Q3.** Scaricare `html5-qrcode@2.3.8` in `lib/html5-qrcode.min.js` (stessa versione oggi caricata), verificarne l'identità con il file servito da unpkg, aggiungere la licenza in `lib/` e l'hash SHA-256 nel README. Sostituire il tag `<script>`, aggiornare `SHELL` in `sw.js` e togliere l'URL di unpkg.

**Q4.** Durante lo scanner, `queue()` programma `sync()` con attesa di 1,5 s (trailing); la sincronizzazione parte subito alla chiusura dello scanner, a `visibilitychange` verso nascosto e quando la coda supera 10 operazioni. Fuori dallo scanner resta immediata. La coda va salvata in `localStorage` a ogni `queue()`.

**Q6.** `getToken_()` legge solo la proprietà `TOKEN`; la costante in `Code.gs` resta il segnaposto e non viene più usata per il confronto. `setup()` si ferma se la proprietà manca. **Il valore non deve cambiare**, altrimenti telefoni e Home Assistant smettono di funzionare. La procedura è nel passo 1 di 6.2: prima si imposta la proprietà, poi si incolla il codice.

**Q7.** `queue()` assegna `opId = uid()` a ogni operazione. Il backend, per ogni richiesta, fa una sola `getAll` e una sola `putAll` su `CacheService.getScriptCache()` con chiavi `op:<opId>` e scadenza 6 ore; un'operazione già vista non viene riapplicata e risponde `{ok:true, dup:true}` (non si memorizza il risultato: l'app non lo legge). Le operazioni senza `opId` (app 1.1) si applicano come oggi.

**Q9.** Trigger settimanale su `snapshot()`. Nessuna cancellazione automatica.

**Q12.** Allineare `LEGGIMI.md` e README al comportamento reale: cadenza 15 minuti e condizione di disponibilità (YAML v1.1.1); codifica dei caratteri speciali del token (`&` → `%26`, `#` → `%23`, `+` → `%2B`, `%` → `%25`, `?` → `%3F`, `=` → `%3D`, spazio → `%20`); "svuota la lista Alexa prima di attivare" (il primo giro importa tutte le voci attive); "Esegui" dal menu dell'automazione salta trigger e condizioni; il nome dell'entità `todo.*` compare 6 volte nel YAML (5 nel codice, 1 nel commento). Il file `homeassistant/dispensa_alexa.yaml` del repository è la v1.1.1 con il segnaposto al posto dell'entità reale. Aggiungere al README la regola "non scrivere righe a mano nel foglio".

---

## 8. Piano di lavoro, test e criteri globali

### 8.1 Fasi e checkpoint

| Fase | Contenuto | Checkpoint (Mario valida) |
|---|---|---|
| 0 | Struttura repository, harness di test con `vm`, fixture, `auditDb()`, `snapshot()`; copie di `lots.js` con marcatori e test di identità | Report di audit sulla copia del foglio reale |
| 1 | Backend: colonna `lotti`, proprietà `catScad`, logica lotti, `delta` e `lotMove`, regole di `upsert`, Q6, Q7; compatibilità 1.1 | Test verdi e prova manuale su copia con app 1.1 |
| 2 | Frontend R2 (flash, doppia lettura, messaggio, indicatore) e Q1, Q2 | Prova su iPhone: flash visibile, doppia lettura gestita |
| 3 | Frontend R1 (pannello, scheda, form, filtri, impostazioni, `LS.srv`) | Prova di spesa simulata: carico di 8 prodotti, 3 con scadenza attiva |
| 4 | Quick win P1 (Q3, Q4) | Tempi e numero di richieste prima/dopo |
| 5 | README, `LEGGIMI.md`, changelog, procedura di rilascio, tag `v1.2.0` | Rilascio sul foglio reale |

### 8.2 Strategia di test

| Livello | Cosa | Strumento |
|---|---|---|
| Unità | Logica dei lotti (Appendice B); `norm`, `matchProduct`, `desired`, `alexaSync` (non devono cambiare) | Node, senza dipendenze |
| Backend | `applyOp`, `openDb`/`saveDb` su foglio finto; test golden (6.5); compatibilità 1.1 incluso `upsert` con campi vecchi; idempotenza | Node con `vm` |
| Integrazione | Due client simulati con sequenze interallacciate; risposta persa e rinvio con `opId` | Node |
| Interfaccia | Scenari R1 e R2: doppia lettura, 6 unità, `prefers-reduced-motion`, pannello, selettore data | Playwright se disponibile, altrimenti checklist manuale |
| Dispositivo | Flash, pannello, modalità silenziosa, rete assente | Mario su iPhone |

### 8.3 Definition of Done

- [ ] Tutti i requisiti P0 implementati; criteri 4.6 e 5.2 verificati.
- [ ] `node test/run.js` verde; test golden dimostra R3.4.
- [ ] `auditDb()` eseguita sul foglio reale, anomalie risolte o accettate da Mario.
- [ ] Migrazione eseguita sulla copia con esito positivo; rollback provato sulla copia nell'ordine di 6.2.
- [ ] README e `LEGGIMI.md` aggiornati; nessun segreto nel repository (ricerca di `script.google.com/macros/s/`, del token e dell'indirizzo email di Mario).
- [ ] Versione `1.2.0` coerente in app, backend e service worker.

## 9. Struttura del repository e rilascio

```
/index.html  /sw.js  /manifest.webmanifest  /icon-192.png  /icon-512.png  /.nojekyll
/lib/html5-qrcode.min.js  /lib/LICENSE-html5-qrcode.txt  /lib/lots.js   (lots.js: fonte di verità)
/backend/Code.gs                     (token solo da Script Properties; segnaposto nel file)
/homeassistant/dispensa_alexa.yaml   (v1.1.1; usa !secret; entità segnaposto)
/docs/LEGGIMI.md  /docs/SPEC-v1.2.md
/test/                               (run.js, test dei lotti, harness, fixture anonimizzata)
/README.md
```

GitHub Pages pubblica l'intera radice: tutto ciò che è nel repository è pubblico. Ordine di rilascio: backend, verifica con app 1.1, frontend. Versioning semantico, tag `v1.2.0`, voce di changelog.

## 10. Decisioni

**Confermate da Mario (2026-11-09):** un tap in più solo per categorie attive; migrazione con la scadenza attuale assegnata a tutta la quantità presente (lotto virtuale); righe del foglio tutte inserite dall'app; pulsanti rapidi `+7` e `+30` giorni; rimandare Q5 e Q8 alla 1.3.

**Modificate dopo l'audit, da riconfermare:**

| ID | Decisione | Motivo |
|---|---|---|
| D1' | Categorie attive all'inizio: **nessuna**; pulsante in Impostazioni per attivare le tre consigliate | Con le tre attive di default il backend 1.2 cambierebbe il comportamento anche delle app 1.1 e la "verifica app 1.1" della migrazione non sarebbe valida; un rollback del solo frontend lascerebbe funzioni che non rispondono |
| D4' | Configurazione condivisa in **Script Properties**, non in un foglio `Config` | Nessun nuovo foglio da proteggere, nessuna lettura in più per richiesta |
| D7 | Nessuna colonna `lotto` in `Movimenti`, nessun annulla | Codice più semplice, meno rischio sulla scrittura |
| D8 | Q7 (`opId`) promossa a P0 insieme al timeout (Q2) | Il timeout senza idempotenza può raddoppiare i carichi |

**Invariate:** D2 (unità registrata subito senza data, poi riassegnata dal pannello), D3 (FEFO: lotti con data in ordine crescente, senza data per ultimi), D5 (token in Script Properties), D6 (italiano).

---

## Appendice A: contratto API

**Richiesta `POST` (corpo JSON, `Content-Type: text/plain`)**

```json
{
  "token": "…",
  "ops": [
    { "op": "delta",   "id": "p1abc", "delta":  1, "lot": "2026-11-20", "user": "Mario", "opId": "o1" },
    { "op": "delta",   "id": "p1abc", "delta": -1,                       "user": "Alba",  "opId": "o2" },
    { "op": "delta",   "id": "p1abc", "delta":  1,                       "user": "Mario", "opId": "o3" },
    { "op": "lotMove", "id": "p1abc", "from": "", "to": "2026-12-05", "q": 1, "user": "Mario", "opId": "o4" },
    { "op": "delta",   "id": "p1abc", "delta": -1, "lot": "2026-11-12", "user": "Mario", "opId": "o5" },
    { "op": "cfgSet",  "key": "catScad", "value": ["Latticini", "Carne e pesce"], "user": "Mario", "opId": "o6" }
  ]
}
```

`opId` è facoltativo (compatibilità 1.1).

**Esempio calcolato** con `lib/lots.js` (Appendice B), partendo da `qty = 3`, `lotti` vuota, `scadenza = 2026-11-10` (lotto virtuale):

| Op | Effetto | `qty` | Lotti dopo l'operazione |
|---|---|---|---|
| o1 | +1 nel lotto 2026-11-20 | 4 | 11-10 ×3, 11-20 ×1 |
| o2 | −1 FEFO (consuma 11-10) | 3 | 11-10 ×2, 11-20 ×1 |
| o3 | +1 senza data | 4 | 11-10 ×2, 11-20 ×1, senza data ×1 |
| o4 | sposta 1 da "senza data" a 12-05 | 4 | 11-10 ×2, 11-20 ×1, 12-05 ×1 |
| o5 | −1 dal lotto 11-12, che **non esiste**: il residuo va in FEFO (consuma 11-10) | 3 | 11-10 ×1, 11-20 ×1, 12-05 ×1 |
| o6 | `catScad` impostata | 3 | invariati |

`scadenza` derivata alla fine: `2026-11-10`.

**Risposta**

```json
{
  "ok": true, "version": "1.2.0",
  "results": [ { "ok": true, "qty": 4 }, { "ok": true, "qty": 3 }, { "ok": true, "qty": 4 },
               { "ok": true }, { "ok": true, "qty": 3 }, { "ok": true } ],
  "items": [ { "id": "p1abc", "qty": 3, "scadenza": "2026-11-10",
               "lotti": "[{\"d\":\"2026-11-10\",\"q\":1},{\"d\":\"2026-11-20\",\"q\":1},{\"d\":\"2026-12-05\",\"q\":1}]" } ],
  "extras": [],
  "config": { "catScad": ["Latticini", "Carne e pesce"] }
}
```

(`items` mostra solo i campi rilevanti.) `GET ?token=…` risponde con `{ok, version, items, extras, config}`. Una operazione duplicata (stesso `opId`) risponde `{ "ok": true, "dup": true }`.

**Errori.** Invariati: `{ok:false, error:'token'|'json'}`; per operazione `{ok:false, error:'non trovato'|'op sconosciuta'|…}`.

## Appendice B: algoritmo di riferimento dei lotti

`lib/lots.js` è la **fonte di verità**, testata (14 test: lotto virtuale, carico con data, unione di lotti, FEFO, senza data per ultimi, scarico oltre la giacenza, riconciliazione, `moveUnits`, scarico da lotto preciso con residuo FEFO, date non ISO, `delta` zero, `parseLots` tollerante, invariante somma = quantità su 20.000 sequenze con seme fisso, coerenza del totale). Va copiato senza varianti in `Code.gs` e `index.html` tra i marcatori `// BEGIN lots.js` e `// END lots.js`; la riga `module.exports` resta solo nel file della libreria. I test sono in `test.js`.

```js
'use strict';
/* Riferimento per la rev. 1.2: logica pura dei lotti, identica lato app e lato Code.gs.
   Lotto = { d: 'YYYY-MM-DD' | '', q: intero > 0 }. d vuoto = senza data. */

// Data valida solo se YYYY-MM-DD, altrimenti 'senza data'.
const isoOrEmpty = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '');
const cmp = (a, b) => (a.d === b.d ? 0 : a.d === '' ? 1 : b.d === '' ? -1 : a.d < b.d ? -1 : 1);
const sorted = lots => lots.slice().sort(cmp);
const total = lots => lots.reduce((s, l) => s + l.q, 0);

function parseLots(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a.filter(l => l && Number(l.q) > 0).map(l => ({ d: isoOrEmpty(l.d), q: Math.floor(Number(l.q)) }));
  } catch (e) { return []; }
}
const serializeLots = lots => (lots.length ? JSON.stringify(sorted(lots).map(l => ({ d: l.d, q: l.q }))) : '');

function addToLot(lots, d, n) {
  d = isoOrEmpty(d);
  const out = lots.map(l => ({ ...l }));
  const f = out.find(l => l.d === d);
  if (f) f.q += n; else out.push({ d, q: n });
  return sorted(out);
}
function consumeFefo(lots, n) {
  const out = []; const taken = []; let left = n;
  for (const l of sorted(lots)) {
    if (left <= 0) { out.push({ ...l }); continue; }
    const t = Math.min(l.q, left); left -= t; taken.push({ d: l.d, q: t });
    if (l.q > t) out.push({ d: l.d, q: l.q - t });
  }
  return { lots: out, taken };
}
// Consumo da un lotto preciso; se non basta (o non esiste) il resto va in FEFO. Il totale scalato è sempre n.
function consumeFromLot(lots, d, n) {
  d = isoOrEmpty(d);
  const f = lots.find(l => l.d === d);
  const t = Math.min(n, f ? f.q : 0);
  const rest = lots.map(l => (l.d === d ? { d: l.d, q: l.q - t } : { ...l })).filter(l => l.q > 0);
  const taken = t ? [{ d, q: t }] : [];
  if (n - t <= 0) return { lots: sorted(rest), taken };
  const r = consumeFefo(rest, n - t);
  return { lots: r.lots, taken: taken.concat(r.taken) };
}
function moveUnits(lots, from, to, n) {
  from = isoOrEmpty(from);
  const f = lots.find(l => l.d === from);
  const t = Math.min(n, f ? f.q : 0);
  if (!t) return lots.map(l => ({ ...l }));
  const rest = lots.map(l => (l.d === from ? { d: l.d, q: l.q - t } : { ...l })).filter(l => l.q > 0);
  return addToLot(rest, to, t);
}
function reconcile(lots, qty) {
  const s = total(lots);
  if (s < qty) return addToLot(lots, '', qty - s);
  if (s > qty) return consumeFefo(lots, s - qty).lots;
  return sorted(lots);
}
// Lotti effettivi di un prodotto tracciato. Non scrive nulla: lotti virtuale se la colonna è vuota.
function effectiveLots(item) {
  const own = parseLots(item.lotti);
  if (own.length) return reconcile(own, item.qty);
  return item.qty > 0 ? [{ d: item.scadenza || '', q: item.qty }] : [];
}
const nextExpiry = lots => (sorted(lots).find(l => l.d !== '') || { d: '' }).d;

// Operazione delta su prodotto tracciato. Restituisce una copia del prodotto con lotti, qty, scadenza coerenti.
function applyDelta(item, delta, lotDate) {
  let lots = effectiveLots(item); let taken = [];
  const qty = Math.max(0, item.qty + delta);
  if (delta > 0) lots = addToLot(lots, lotDate || '', delta);
  else if (delta < 0) {
    const n = Math.min(-delta, item.qty);
    const r = lotDate ? consumeFromLot(lots, lotDate, n) : consumeFefo(lots, n);
    lots = r.lots; taken = r.taken;
  }
  return { item: { ...item, qty, lotti: serializeLots(lots), scadenza: nextExpiry(lots) }, taken };
}
module.exports = { isoOrEmpty, parseLots, serializeLots, addToLot, consumeFefo, consumeFromLot, moveUnits, reconcile, effectiveLots, nextExpiry, applyDelta, total };
```

## Appendice C: mappa del codice v1.1

| Elemento | Posizione |
|---|---|
| Costanti `VERSION`, `LS`, `DEF_CAT`, `SOON_DAYS` | `index.html` righe 186–191 |
| `apiGet`, `apiPost`, `queue`, `sync`, `setSync` | righe 244–277 |
| `daysTo`, `expTag`, `fmtDate`, `isSoon`, `isLow`, `inLista`, `inSpesa` | righe 280–296 |
| `changeQty`, `upsert` | righe 300–317 |
| `row`, `renderInv`, `renderShop` | righe 332–416 |
| `openDetail`, `openForm`, `openSettings` | righe 435–565 |
| Scanner: `setMode`, `scanMsg`, `openScanner`, `closeScanner`, `beep`, `onCode`, `offLookup` | righe 570–655 |
| Anti doppia lettura | riga 615 |
| `exportCsv` | riga 688 |
| Overlay scanner | CSS righe 103–115, HTML righe 163–179 |
| `Code.gs`: costanti e colonne | righe 15–23 |
| `Code.gs`: `setup`, `header` | righe 27–55 |
| `Code.gs`: `doGet`, `doPost`, `waitLock` | righe 57–85 |
| `Code.gs`: `openDb`, `toItem`, `saveDb`, `writeTable`, `log` | righe 91–143 |
| `Code.gs`: `applyOp` (copia dei campi di `upsert` righe 160–162) | righe 147–230 |
| `Code.gs`: `alexaSync`, `pulisciStorico` | righe 270–346 |

## Appendice D: esito dell'audit indipendente (2026-11-09)

Revisione eseguita da un modello di livello superiore, con lettura del codice reale. Tutti i finding BLOCCANTI e ALTI sono recepiti.

| Finding | Recepito in |
|---|---|
| B1 `upsert` copia `lotti`/`scadenza` vecchie | R1.4a, 6.5, 4.6 |
| B2 gating deadlock con `catScad` vuoto | R1.15 |
| B3 doppia lettura cancella il messaggio | R2.2a, 5.2 |
| B4 R3.4 e test golden incompatibili con `writeTable` | R3.4, 6.5, 4.6 |
| A1 consumo da lotto preciso mancante nell'algoritmo | `lots.js` (`consumeFromLot`), R1.4, test |
| A2 esempio dell'Appendice A incoerente | Appendice A, ricalcolata |
| A3 timeout 20 s con lock da 20 s | Q2 (45 s) e Q7 a P0 |
| A4 errore su `Movimenti` dopo `Prodotti` | colonna `lotto` eliminata (D7); fatto 2.3 n. 11 |
| A5 6 unità chiedono la data più volte | R1.9 (contatore `n`, un solo `lotMove`) |
| A6 categorie attive di default cambiano le app 1.1 | D1' |
| A7 configurazione non persistita offline | R1.8 (`LS.srv`) |
| A8 blackout del token | Q6, 6.2 passi 1-3 |
| M1-M12, L1-L9 | R1.7, R1.9, R1.13, R2.3, R2.4, R3.3, 6.2, 6.4, Q9, 4.5 |
