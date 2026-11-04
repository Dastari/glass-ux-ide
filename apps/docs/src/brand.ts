import { configureBrand, type BrandSource } from "glass-ux/brand";

/** Two brackets and a stroke, in the two tones a brand mark takes. */
const MARK: BrandSource = {
  id: "glass-ux-ide",
  viewBox: "0 0 32 32",
  primary: [{ d: "M12 8 4 16l8 8 2.8-2.8L9.6 16l5.2-5.2zM20 8l8 8-8 8-2.8-2.8 5.2-5.2-5.2-5.2z" }],
  secondary: [{ d: "m18.2 5 2.8 1-7.2 21-2.8-1z" }],
};

/** Registers the site's marks. */
export function configureDocsBrand() {
  configureBrand({ marks: { product: MARK, wordmark: MARK, ai: MARK } });
}
