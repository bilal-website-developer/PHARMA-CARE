# Customer Display — Frontend Guide

The customer display is a read-only, second-window view of the active POS sale. Its UI lives in `src/components/CustomerDisplayView.tsx`; the POS launch and live updates are in `src/components/POSBillingView.tsx`; message types, validation, payment summaries, and similar-medicine matching are in `src/utils/customerDisplay.ts`.

## How it opens and updates

- An operator with POS access selects **Customer display** in POS. The app creates a random channel ID and opens `/customer-display?channel=<id>`.
- The customer route is handled by `src/App.tsx`. It requires an authenticated account with POS access (Admin roles are allowed).
- POS and display exchange validated messages over the browser `BroadcastChannel` API. Snapshots update as the cart, discount, checkout stage, or payment values change. When the display opens, it sends `ready` and POS sends the current screen state.
- **Important limitation:** `BroadcastChannel` shares between same-origin tabs/windows in the same browser profile. It does not send updates to a separate phone, tablet, or computer. A separate-device display needs a server/realtime transport, which is not implemented.
- Vercel's `vercel.json` rewrite lets direct client-side routes load the Vite app. The `channel` query parameter is required; invalid links show an error.

## Screen states

1. **Welcome / idle:** Pharma Care logo (or saved shop logo), “Welcome,” and a prompt that order details will appear. Shown before items are added or after the display is reset.
2. **Current order:** A count and a bill table with Medicine, Qty, Batch, Expiry, and Amount. Each item also shows its unit and per-unit price. The footer remains visible.
3. **Payment details:** The same order plus the payment summary. Shows subtotal, optional discount, and total. Credit displays only the amount due for this bill; other methods show paid, this-bill due, and change. All money values are formatted as `Rs. xx.xx` from integer paisa.
4. **Also available:** Optional alternatives for the current medicine. Up to three selectable matches show brand, company, strength/unit, and price; if none qualify, an empty-state message is shown. A customer selection is sent to POS, which replaces that cart line.
5. **Thank you:** Confirmation icon, “Thank you,” and a short closing message after a completed sale.
6. **Error:** Invalid/missing channel, unsupported browser, or channel setup failure is displayed as an alert instead of a blank screen.

## Layout and visual design

- Full-viewport, overflow-hidden layout intended for a customer-facing monitor; centered content is capped at `max-w-5xl`.
- Pale emerald/mint gradient background, soft decorative blurred circles, dark emerald text, white translucent cards, thin green borders, and subtle shadows.
- Header: shop logo or Pharma Care logo on the left; green “Live” pill on the right. Footer: “Pharma Care · Thank you for visiting.”
- Responsive padding and type scales use Tailwind `sm` and `lg` breakpoints. The bill table keeps five columns and truncates long product, batch, and expiry text rather than growing the page.
- Item row density adapts to item count: comfortable (up to five), compact (six to ten), dense (more than ten). The available row height is measured with `ResizeObserver`; if the list needs multiple pages, it rotates every five seconds.
- Sections use polite live regions; errors use `role="alert"`. Buttons for alternatives have accessible labels and visible keyboard focus.
- Motion is controlled by the app's personal display preferences. Keep animations subtle and preserve the reduced/disabled-animation behavior when changing visual effects.

## Similar-medicine option rules

- The operator enables **Show similar medicines on customer display** in personal Display preferences. This is saved per operator in browser storage and synchronized to the POS view in that browser.
- Candidates must be a different product with matching normalized generic name and strength, a sale unit, and enough eligible stock for the requested quantity under FEFO allocation.
- The default sale unit is preferred; otherwise the first unit is used. Matches sort by unit price, then brand, and are capped at three.
- Selecting an option changes the POS cart line. It is not a separate purchase or a customer-side database write.

## Data and privacy boundaries

- The display receives only the current sale presentation fields: product/unit labels, quantity, batch/expiry, unit and line prices, subtotal, discount, total, and payment summary.
- It does not receive cost, margin/profit, supplier details, customer phone, or customer history.
- The display consumes validated message shapes from `parseCustomerDisplayMessage`; keep validation and the allowlisted snapshot projection when changing the UI.
- The header logo is read from the app's saved shop-logo setting. The page currently has no dedicated theme editor or configurable welcome/footer copy.

## Safe places to customize

- **Visual layout, copy, colors, spacing, and card/table structure:** edit `src/components/CustomerDisplayView.tsx`.
- **New display fields, stage behavior, payment calculations, validation, or alternative matching:** update `src/utils/customerDisplay.ts` and its tests in `src/utils/customerDisplay.test.ts`.
- **When the display opens, what POS sends, and how a selected option affects the cart:** edit the customer-display logic in `src/components/POSBillingView.tsx`.
- **Route access behavior:** review the `/customer-display` branch in `src/App.tsx`.

Avoid putting checkout controls, customer data, or cost fields on this public-facing screen. Preserve the POS permission check, message validation, same-browser behavior unless a separate-device transport is deliberately implemented, and responsive fit for long bills.
