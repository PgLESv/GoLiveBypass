# Proton password visibility toggle

## Objective

Let a person reveal or hide the password they typed in the **Proton Otimizado** login form.

## Design

- Wrap only the password input in a positioned container.
- Add an icon-only button at its right edge. It toggles the input's `type` between `password` and `text`.
- Render an open-eye SVG while the password is hidden and a crossed-eye SVG while it is visible.
- Maintain focus on the password input after toggling. The button has `type="button"`, a dynamic Portuguese `aria-label`, and `aria-pressed`.
- The button fits the existing Proton styling; extra right padding prevents text from overlapping the icon.

## Verification

- Type-check and build the GUI.
- Confirm the toggle is isolated to the Proton password field and does not alter the 2FA field or login submission.
