import {expect} from "chai";
import {
	buildCatalog,
	choiceFor,
	normalizeDeviceChoice,
	type DeviceChoices,
} from "../../client/js/translate/models";

describe("translate/devices", () => {
	describe("normalizeDeviceChoice", () => {
		it("keeps the three values", () => {
			for (const value of ["auto", "gpu", "cpu"] as const) {
				expect(normalizeDeviceChoice(value)).to.equal(value);
			}
		});

		it("reads anything else as auto", () => {
			for (const value of ["npu", null, undefined, 1, "", {}]) {
				expect(normalizeDeviceChoice(value)).to.equal("auto");
			}
		});
	});

	describe("choiceFor", () => {
		it("maps a model's family to its own setting", () => {
			const choices: DeviceChoices = {llm: "gpu", opus: "cpu", nllb: "auto"};
			const catalog = buildCatalog();

			expect(choiceFor(catalog.llm, choices)).to.equal("gpu");
			expect(choiceFor(catalog.opus["de-en"], choices)).to.equal("cpu");
			expect(choiceFor(catalog.nllb, choices)).to.equal("auto");
		});
	});
});
