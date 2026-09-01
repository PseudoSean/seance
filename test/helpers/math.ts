import {expect} from "chai";
import {renderMath} from "../../client/js/helpers/ircmessageparser/math";

// `math.ts` is Vue-free, so the KaTeX path is unit-testable: the module loads
// lazily, and everything it hands back is KaTeX's own markup. In the app it is
// `MathSpan.vue` that sets it as innerHTML — the TeX never reaches the DOM as
// anything KaTeX did not render.
describe("helpers/math — renderMath", () => {
	it("renders inline TeX to KaTeX markup", async () => {
		const html = await renderMath("E=mc^2", false);

		expect(html).to.be.a("string");
		expect(html).to.contain("katex");
		expect(html).to.not.contain("E=mc^2</script>");
	});

	it("marks a display render as display", async () => {
		const html = await renderMath("x = y", true);

		expect(html).to.be.a("string");
		expect(html).to.contain("katex-display");
	});

	it("renders a broken TeX as KaTeX error text instead of throwing", async () => {
		const html = await renderMath("\\frac{", false);

		expect(html).to.be.a("string");
		expect(html).to.contain("katex-error");
	});

	it("renders nothing for empty TeX", async () => {
		expect(await renderMath("", false)).to.equal(undefined);
		expect(await renderMath("   ", true)).to.equal(undefined);
	});
});
