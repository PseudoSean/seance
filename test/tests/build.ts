import {expect} from "chai";
import fs from "fs";
import path from "path";

describe("public folder", function () {
	const publicFolder = path.join(process.cwd(), "public");

	it("font awesome files are copied", function () {
		expect(fs.existsSync(path.join(publicFolder, "fonts", "fa-solid-900.woff"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "fonts", "fa-solid-900.woff2"))).to.be.true;
	});

	it("files in root folder are copied", function () {
		expect(fs.existsSync(path.join(publicFolder, "favicon.ico"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "robots.txt"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "service-worker.js"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "thelounge.webmanifest"))).to.be.true;
	});

	it("branding config.json is copied and parses", function () {
		const file = path.join(publicFolder, "config.json");
		expect(fs.existsSync(file)).to.be.true;

		const config = JSON.parse(fs.readFileSync(file, "utf8"));
		expect(config).to.be.an("object");
		expect(config.appName).to.be.a("string").that.is.not.empty;
	});

	it("index HTML and manifest carry the build-time branding", function () {
		const config = JSON.parse(fs.readFileSync(path.join(publicFolder, "config.json"), "utf8"));
		const html = fs.readFileSync(path.join(publicFolder, "index.html"), "utf8");
		const manifest = JSON.parse(
			fs.readFileSync(path.join(publicFolder, "thelounge.webmanifest"), "utf8")
		);

		expect(html.includes("__APP_NAME__")).to.be.false;
		expect(html.includes("__THEME_COLOR__")).to.be.false;
		expect(html.includes(`<title>${config.appName}</title>`)).to.be.true;
		expect(html.includes("The Lounge")).to.be.false;
		expect(manifest.name).to.equal(config.appName);
		expect(manifest.short_name).to.be.a("string").that.is.not.empty;
	});

	it("audio files are copied", function () {
		expect(fs.existsSync(path.join(publicFolder, "audio", "pop.wav"))).to.be.true;
	});

	it("index HTML file is copied with cache bust applied", function (done) {
		expect(fs.existsSync(path.join(publicFolder, "index.html.tpl"))).to.be.false;

		fs.readFile(path.join(publicFolder, "index.html"), "utf8", function (err, contents) {
			expect(err).to.be.null;

			expect(contents.includes('<div id="app"></div>')).to.be.true;
			expect(contents.includes("__HASH__")).to.be.false;

			done();
		});
	});

	it("javascript files are built", function () {
		expect(fs.existsSync(path.join(publicFolder, "js", "bundle.js"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "js", "bundle.vendor.js"))).to.be.true;
	});

	it("style files are built", function () {
		expect(fs.existsSync(path.join(publicFolder, "css", "style.css"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "css", "style.css.map"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "themes", "default.css"))).to.be.true;
		expect(fs.existsSync(path.join(publicFolder, "themes", "morning.css"))).to.be.true;
	});

	it("style files contain expected content", function (done) {
		fs.readFile(path.join(publicFolder, "css", "style.css"), "utf8", function (err, contents) {
			expect(err).to.be.null;

			expect(contents.includes("var(--body-color)")).to.be.true;
			expect(contents.includes("url(../fonts/fa-solid-900.woff2)")).to.be.true;
			expect(contents.includes(".tooltipped{position:relative}")).to.be.true;
			expect(contents.includes("sourceMappingURL")).to.be.true;

			done();
		});
	});

	it("javascript map is created", function () {
		expect(fs.existsSync(path.join(publicFolder, "js", "bundle.js.map"))).to.be.true;
	});

	it("loading-error-handlers.js is copied", function () {
		expect(fs.existsSync(path.join(publicFolder, "js", "loading-error-handlers.js"))).to.be
			.true;
	});

	it("service worker has cacheName set", function (done) {
		fs.readFile(path.join(publicFolder, "service-worker.js"), "utf8", function (err, contents) {
			expect(err).to.be.null;

			expect(contents.includes("const cacheName")).to.be.true;
			expect(contents.includes("__HASH__")).to.be.false;

			done();
		});
	});

	it("service worker precaches the app shell and has no server-side hooks", function (done) {
		fs.readFile(path.join(publicFolder, "service-worker.js"), "utf8", function (err, contents) {
			expect(err).to.be.null;

			// Offline shell: index.html and the manifest are precached on install
			expect(contents.includes('"index.html"')).to.be.true;
			expect(contents.includes('"thelounge.webmanifest"')).to.be.true;
			expect(contents.includes('addEventListener("notificationclick"')).to.be.true;

			// Nothing is left that expects the old Node server
			expect(contents.includes("socket.io")).to.be.false;
			expect(contents.includes("uploads")).to.be.false;
			expect(contents.includes("storage")).to.be.false;
			expect(contents.includes('addEventListener("push"')).to.be.false;

			done();
		});
	});
});
