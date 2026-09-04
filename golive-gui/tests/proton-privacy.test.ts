import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("privacidade da conta Proton", () => {
  it("mascara o e-mail e revela somente sob interacao", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/style.css"), "utf8");
    expect(html).toContain('id="protonUserDisplay" class="proton-private-email"');
    expect(html).toContain('tabindex="0"');
    expect(css).toMatch(/\.proton-private-email\s*\{[\s\S]*filter:\s*blur\(5px\)/);
    expect(css).toMatch(/\.proton-private-email:hover,[\s\S]*\.proton-private-email:focus-visible[\s\S]*filter:\s*blur\(0\)/);
  });
});
