# Proton login input height

## Objective

Make the e-mail/username and password fields in the **Proton Otimizado** login form easier to use by increasing their height from 60px to 70px.

## Scope

- Change only the `.proton-form-fields .proton-input` rule in `golive-gui/src/style.css`.
- Preserve all colors, spacing, typography, behavior, and responsive layout.
- Keep the 2FA field and all non-Proton inputs unchanged.

## Verification

- Run the GUI TypeScript/Vite build to confirm the stylesheet is accepted.
- Inspect the diff to ensure the adjustment is isolated to the approved height value.
