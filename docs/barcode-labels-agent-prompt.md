# Barcode: generate, assign, print and scan (agent prompt for Pharma Care)

Save as `docs/barcode-labels-agent-prompt.md`. Paste the block below into the VS Code agent chat. It replaces the earlier long barcode prompt. Parts it leaves out are listed at the end.

```
You are a senior React 19 / TypeScript / Supabase engineer on Pharma Care (local folder PHARMCYYYY). Goal: let the shop GENERATE barcodes for medicines that have none, SAVE them, PRINT labels with real barcodes, and SCAN them back. Keep messages short.

SELF-CONTAINED: do not look for docs/BARCODE_AGENT_PROMPT.md. Paths below are hints; if a file is missing, find the equivalent with your search tool and continue. Never stop only because a path is missing.

STACK FACTS (do not change)
- React 19 + TypeScript strict + Vite. Tailwind v4 (no tailwind.config.js; tokens in @theme in src/index.css). Supabase JS v2 (client in src/utils/supabase.ts). No react-router (pages switch by state in App.tsx and Sidebar.tsx; do not add a router).
- Tests: node:test via tsx, one script per test file (test:labels, test:fefo, test:discount, ...). Add a test:<name> script for every new test file AND chain it into npm test.
- Installed: qrcode, jsbarcode, react-to-print, @e965/xlsx, lucide-react.
- Existing label code (verify it exists; build on it, do not rename its public API, add rather than replace): src/utils/labelUtils.ts, src/utils/useBarcodeScanner.ts, src/components/labels/ (QRGenerator, BarcodeRenderer, LabelPreview, LabelPrintQueue), the Label Studio page, label print CSS in src/index.css.

GIT AND SQL RULES
- First run git status and git branch --show-current. Create a NEW branch barcode/labels from the current branch. Leave unrelated uncommitted files untouched (docs/DATABASE.md, SuppliersView.tsx, docs/design-reference, untracked supabase files, if present). Commit in small steps containing ONLY task files and run git show --stat after each commit to confirm nothing else (the pre-commit hook may add PROJECT_CONTEXT.md; that is fine). Do not merge.
- You NEVER run SQL, migrations or deploys. You write migration FILES (timestamped, in supabase/migrations/) plus a rollback file for each, show them in full, and tell me exactly what to run and in which order. Never claim SQL was applied.
- SQL house pattern: RLS stays on; functions are SECURITY DEFINER with set search_path = public, check auth.uid() IS NOT NULL and public.has_any_permission(array['products']) INSIDE the function body, revoke execute from public and anon, grant execute to authenticated, and write an audit_logs row (same shape other RPCs such as save_medicine and adjust_stock use; read them first). Any NEW table needs explicit GRANT SELECT to authenticated plus RLS policies, because default grants are being removed. NEVER grant anything on stock_batches, purchases, purchase_items, sale_items or sale_item_batch_allocations to anon or authenticated. Read supabase/baseline/00_baseline_schema.sql and the latest migrations before writing SQL; match real column names.
- Permission keys: reuse 'products' for all label features. Do NOT invent a module key. Read the CURRENT profiles.permissions check constraint from the migrations instead of copying an old list.

DATA RULES
- No `any` (use unknown + guards). npm run lint must stay at zero errors. Money stays integer paisa. Labels, QR codes and exported files must NEVER contain cost price, profit or margin; the only price allowed on a label is MRP/selling price.
- App screens use theme tokens only (Light Mint / Emerald Night, Normal/Large UI). The printed label itself is plain black on white, no theme colours, no gradients, no shadows.
- Do not touch the memo slip print engine (renderPharmacyMemo, receipt.ts) or the POS discount code.

PHASE 0: DISCOVERY (read-only). Then STOP and wait for my approval.
Report a short table:
1. Which label files actually exist and what each exports.
2. Which components render the Products page and the Stock Inventory page, and which has the per-row Label button.
3. The barcode columns in the schema: medicines.barcode, and any barcode column on medicine_units (pack/strip levels). Is there already a unique index on barcode? Which RPCs already read or write barcode (save_medicine, products_list, products_import_preview, products_bulk_import)?
4. How scanning works today (POS handleScan, useBarcodeScanner) and what it searches (mock catalog or real data). Which RPC lets the app search medicines by barcode, code, or batch number WITHOUT reading the cost tables directly (products_list search, stock_batches_list p_search)?
5. How labels print today (LabelPrintQueue, @page rules in src/index.css, window.print or react-to-print) and which label sizes exist.
6. The current permissions CHECK constraint keys, and the list of existing RPC names.
7. Anything that could break. Also give me ONE read-only SQL query I can run to find duplicate non-empty barcodes in medicines (needed before a unique index).
Do not edit anything in Phase 0.

PHASE 1 (after approval): GENERATE AND ASSIGN BARCODES
1. labelUtils.ts, pure and tested: BarcodeFormat = 'CODE128' | 'EAN13' | 'UPC' | 'CODE39' | 'ITF' with a BARCODE_FORMATS label list; ean13CheckDigit(payload12), isValidEan13(value), isValidForFormat(value, format). Do not generate numbers on the client (two users could collide).
2. BarcodeRenderer: validate before drawing. For an invalid value show a visible inline error instead of a blank SVG.
3. SQL files (I will run them by hand), each with a rollback:
   a. File 1: a sequence medicine_barcode_seq and RPC assign_medicine_barcode(p_medicine_id uuid, p_barcode text default null, p_replace boolean default false) returns text. If p_barcode is null it generates the next internal EAN-13 on the server: "200" + 9-digit zero-padded sequence + check digit (200-prefix = GS1 internal/restricted-circulation range), retrying on collision. If p_barcode is given it validates the format (EAN-13 check digit, or non-empty CODE128 text), refuses to overwrite an existing barcode unless p_replace is true, and returns friendly errors (not raw Postgres errors).
   b. File 1 also adds RPC assign_missing_barcodes(p_medicine_ids uuid[]) returns jsonb: fills ONLY empty barcodes in one transaction, returns {assigned, skipped, failed}. A bulk call must be one request, not one per product.
   c. File 2 (separate, so I can skip it if duplicates exist): create unique index if not exists medicines_barcode_unique on public.medicines (barcode) where barcode is not null and barcode <> ''.
   d. Give me the exact run order, a check query after each file (for example list the functions with proname like 'assign_%'), and the line: notify pgrst, 'reload schema';
4. UI (Products page): a Barcode column showing the value or a Generate button when empty; a toolbar action "Generate missing barcodes" for the selected rows (or the current filtered page if none selected) that calls assign_missing_barcodes and shows how many were assigned, skipped, failed. Existing manufacturer barcodes are never overwritten. Cashier-type users without the products permission see no generate actions.
5. Tests: ean13CheckDigit with known-good values, isValidEan13 true and false cases, isValidForFormat per format. Wire the test script into npm test.

PHASE 2: PRINT LABELS (the main goal)
1. A "Print labels" dialog opened from a product row, from selected rows, and from Label Studio. Options: label size (30x20, 50x30, 58x40 mm and an A4 sheet), barcode format (default EAN-13 for 13-digit codes, CODE128 otherwise), copies per label 1 to 20, which fields to show (name, strength, MRP price, expiry, batch, generic name; NEVER cost), a live preview that is the same renderer used for the real print.
2. Print CSS: exact @page size per label size, zero margins, break-inside: avoid so a label never splits, no browser "shrink to fit". A4 sheet layout with exact mm gaps. Reuse the existing print queue; use react-to-print or the existing print path, but do not change the memo slip printing.
3. Barcode quality on small thermal labels: draw the SVG at fixed physical size in mm (not scaled by CSS %); bar width at least 0.25 mm (2 dots at 203 dpi); bar height 
```

Parts it leaves out are listed at the end.
