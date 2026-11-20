# Short per-shop invoice numbers

The Returns panel now starts its invoice field with `INV-`, so staff can enter only the digits for new invoices. It still accepts a complete older invoice number or a scanned/pasted receipt URL.

The SQL package assigns new sales an `INV-` number with at least six digits, using an atomic counter on the existing `shops` row. It does not create a table, renumber old sales, or run automatically.

## Owner-run order

1. Confirm the scoped `public.post_sale(uuid,text,jsonb,integer,integer,integer,jsonb)` from Batch 027 and the unique `sales_shop_invoice_number_key` index are present.
2. Review and apply `202611200003_short_shop_invoice_numbers.sql` in the intended Supabase project.
3. Run `202611200003_short_shop_invoice_numbers.test.sql`; it verifies the counter, uniqueness, and function definition without posting a sale.
4. In a controlled shop, make one test sale and confirm a number such as `INV-000123` appears in Sales History and the receipt; enter only `000123` in Returns and confirm it finds the sale.
5. Also test a pre-existing long invoice by pasting its full value. Do not retry a real checkout if the response is unclear; check Sales History first.

Counter allocation is serialized by updating that shop's row within the sale transaction. This preserves uniqueness under concurrent checkouts and does not promise gapless numbering if records are manually changed.

## Rollback

Run `202611200003_short_shop_invoice_numbers.rollback.sql`. It restores UUID-derived numbers for future sales but does not rewrite existing short numbers or drop the counter. Both old and already-issued short invoice values remain available to exact-match return lookup.

The apply, test, and rollback files are drafts only. No SQL has been executed against Supabase.
