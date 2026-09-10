import {expect} from "chai";
import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.resolve(__dirname, "../../client/themes/heart.css"), "utf8");

describe("the <3 theme (client/themes/heart.css)", function () {
	it("is coffee's rules with its own tokens", function () {
		expect(css.startsWith("/*")).to.be.true;
		expect(css).to.include('@import "coffee.css";');
		expect(css).to.include("color-scheme: light;");
		expect(css).to.include("--chat-bg: #dbeeff;");
	});
});
