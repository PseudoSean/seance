import {expect} from "chai";
import sinon from "ts-sinon";
import {BrandingUploads, DEFAULT_UPLOAD_MAX_BYTES} from "../../client/js/branding";
import {
	UPLOADS_NOT_CONFIGURED,
	UploadHost,
	Uploader,
	buildUploadRequest,
	parseUploadResponse,
	uploadFile,
	uploadMaxSize,
} from "../../client/js/upload";

const ENDPOINT = "https://files.example.test/upload";

function textFile(name = "hello.txt", content = "hello", type = "text/plain"): File {
	return new File([content], name, {type});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {"content-type": "application/json"},
	});
}

/** Replace the global `fetch` for one test; restored by `sinon.restore()`. */
function stubFetch(...responses: (Response | Error)[]): sinon.SinonStub {
	const stub = sinon.stub(globalThis, "fetch");

	responses.forEach((response, i) => {
		if (response instanceof Error) {
			stub.onCall(i).rejects(response);
		} else {
			stub.onCall(i).resolves(response);
		}
	});

	return stub;
}

/** Await `promise` and return the message it rejects with. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (e: unknown) {
		return e instanceof Error ? e.message : String(e);
	}

	throw new Error("expected the promise to reject");
}

interface FakeHost extends UploadHost {
	errors: string[];
	urls: string[];
	config: BrandingUploads | undefined;
	connected: boolean;
}

function fakeHost(config: BrandingUploads | undefined): FakeHost {
	const host: FakeHost = {
		errors: [],
		urls: [],
		config,
		connected: true,
		uploads: () => host.config,
		isConnected: () => host.connected,
		renderCanvas: () => false,
		showError: (message) => host.errors.push(message),
		insertUrl: (url) => host.urls.push(url),
	};

	return host;
}

describe("upload", function () {
	afterEach(function () {
		sinon.restore();
	});

	describe("buildUploadRequest", function () {
		it("posts multipart with the default field name and no credentials", function () {
			const init = buildUploadRequest(textFile(), {endpoint: ENDPOINT});

			expect(init.method).to.equal("POST");
			expect(init.credentials).to.equal("omit");
			expect(init.headers).to.deep.equal({});

			const body = init.body as FormData;
			expect(body).to.be.instanceOf(FormData);
			const file = body.get("file");
			expect(file).to.be.instanceOf(File);
			expect((file as File).name).to.equal("hello.txt");
			expect((file as File).size).to.equal(5);
		});

		it("honours fieldName, headers and withCredentials", function () {
			const init = buildUploadRequest(textFile(), {
				endpoint: ENDPOINT,
				fieldName: "attachment",
				withCredentials: true,
				headers: {"X-Api-Key": "s3cret", "Content-Type": "text/plain"},
			});

			expect(init.credentials).to.equal("include");
			// The browser must set the multipart boundary itself.
			expect(init.headers).to.deep.equal({"X-Api-Key": "s3cret"});
			expect((init.body as FormData).get("attachment")).to.be.instanceOf(File);
			expect((init.body as FormData).get("file")).to.equal(null);
		});
	});

	describe("parseUploadResponse", function () {
		it("reads the url key of a JSON body, resolving relative URLs", function () {
			const config = {endpoint: ENDPOINT};

			expect(
				parseUploadResponse('{"url":"https://cdn.example.test/a.png"}', config)
			).to.equal("https://cdn.example.test/a.png");
			expect(parseUploadResponse('{"url":"/f/a.png"}', config)).to.equal(
				"https://files.example.test/f/a.png"
			);
		});

		it("supports a custom key and a plain-text URL body", function () {
			expect(
				parseUploadResponse('{"data":{"x":1},"link":"https://x.test/1"}', {
					endpoint: ENDPOINT,
					responseUrlKey: "link",
				})
			).to.equal("https://x.test/1");

			expect(parseUploadResponse("  https://x.test/2\n", {endpoint: ENDPOINT})).to.equal(
				"https://x.test/2"
			);
		});

		it("rejects bodies without a usable URL", function () {
			const config = {endpoint: ENDPOINT};

			expect(() => parseUploadResponse('{"url":"javascript:alert(1)"}', config)).to.throw(
				'did not return a "url" URL'
			);
			expect(() => parseUploadResponse('{"error":"quota exceeded"}', config)).to.throw(
				"quota exceeded"
			);
			expect(() => parseUploadResponse("<html>nope</html>", config)).to.throw(
				"did not return a URL"
			);
		});
	});

	describe("uploadFile", function () {
		it("sends the file to the endpoint with the stubbed global fetch", async function () {
			const fetchStub = stubFetch(jsonResponse({url: "https://cdn.example.test/x"}));

			const url = await uploadFile(textFile(), {
				endpoint: ENDPOINT,
				headers: {"X-Api-Key": "k"},
			});

			expect(url).to.equal("https://cdn.example.test/x");
			expect(fetchStub.calledOnce).to.be.true;
			expect(fetchStub.firstCall.args[0]).to.equal(ENDPOINT);

			const init = fetchStub.firstCall.args[1] as RequestInit;
			expect(init.method).to.equal("POST");
			expect(init.headers).to.deep.equal({"X-Api-Key": "k"});
			expect(init.body).to.be.instanceOf(FormData);
		});

		it("surfaces HTTP errors, preferring a JSON error message", async function () {
			stubFetch(
				jsonResponse({error: "file type not allowed"}, 415),
				new Response("boom", {status: 502})
			);

			expect(await rejectionMessage(uploadFile(textFile(), {endpoint: ENDPOINT}))).to.equal(
				"file type not allowed"
			);

			expect(await rejectionMessage(uploadFile(textFile(), {endpoint: ENDPOINT}))).to.equal(
				"Upload failed: HTTP 502"
			);
		});

		it("surfaces network failures", async function () {
			stubFetch(new TypeError("Failed to fetch"));

			expect(await rejectionMessage(uploadFile(textFile(), {endpoint: ENDPOINT}))).to.equal(
				"Upload failed: Failed to fetch"
			);
		});
	});

	describe("Uploader", function () {
		it("defaults the size limit to 10 MiB", function () {
			expect(uploadMaxSize(undefined)).to.equal(10 * 1024 * 1024);
			expect(uploadMaxSize({endpoint: ENDPOINT})).to.equal(DEFAULT_UPLOAD_MAX_BYTES);
			expect(uploadMaxSize({endpoint: ENDPOINT, maxSizeBytes: 1})).to.equal(1);
		});

		it("reports uploads as not configured once when branding has no endpoint", async function () {
			const fetchStub = stubFetch();
			const host = fakeHost(undefined);
			const uploader = new Uploader(host);

			await uploader.triggerUpload([textFile()]);
			await uploader.triggerUpload([textFile()]);

			expect(host.errors).to.deep.equal([UPLOADS_NOT_CONFIGURED]);
			expect(host.urls).to.deep.equal([]);
			expect(fetchStub.called).to.be.false;
		});

		it("refuses files over maxSizeBytes without contacting the endpoint", async function () {
			const fetchStub = stubFetch(jsonResponse({url: "https://cdn.example.test/small"}));
			const host = fakeHost({endpoint: ENDPOINT, maxSizeBytes: 3});
			const uploader = new Uploader(host);

			await uploader.triggerUpload([
				textFile("big.txt", "too big"),
				textFile("ok.txt", "ok"),
			]);

			expect(host.errors).to.deep.equal(["File big.txt is over the maximum allowed size"]);
			expect(host.urls).to.deep.equal(["https://cdn.example.test/small"]);
			expect(fetchStub.calledOnce).to.be.true;
		});

		it("uploads queued files in order and inserts each URL", async function () {
			const fetchStub = stubFetch(
				jsonResponse({url: "https://cdn.example.test/1"}),
				new Response("https://cdn.example.test/2", {status: 201})
			);
			const host = fakeHost({endpoint: ENDPOINT});
			const uploader = new Uploader(host);

			await uploader.triggerUpload([textFile("a.txt"), null, textFile("b.txt")]);

			expect(host.urls).to.deep.equal([
				"https://cdn.example.test/1",
				"https://cdn.example.test/2",
			]);
			expect(host.errors).to.deep.equal([]);
			expect(fetchStub.callCount).to.equal(2);
			expect((fetchStub.firstCall.args[1] as RequestInit).credentials).to.equal("omit");
		});

		it("shows a network error as a user-visible error and keeps going", async function () {
			stubFetch(new TypeError("Failed to fetch"), jsonResponse({url: "https://x.test/ok"}));
			const host = fakeHost({endpoint: ENDPOINT});
			const uploader = new Uploader(host);

			await uploader.triggerUpload([textFile("a.txt"), textFile("b.txt")]);

			expect(host.errors).to.deep.equal(["Upload failed: Failed to fetch"]);
			expect(host.urls).to.deep.equal(["https://x.test/ok"]);
		});

		it("refuses to upload while disconnected", async function () {
			const fetchStub = stubFetch();
			const host = fakeHost({endpoint: ENDPOINT});
			host.connected = false;

			await new Uploader(host).triggerUpload([textFile()]);

			expect(host.errors).to.deep.equal([
				"You are currently disconnected, unable to initiate upload process.",
			]);
			expect(fetchStub.called).to.be.false;
		});
	});
});
