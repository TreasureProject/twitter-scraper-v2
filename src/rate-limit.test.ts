import { ApiError } from "./errors";
import { ErrorRateLimitStrategy } from "./rate-limit";

test("error rate limit strategy throws error when triggered", async () => {
	const strategy = new ErrorRateLimitStrategy();

	await expect(() =>
		strategy.onRateLimit({
			fetchParameters: ["/", {}],
			response: {
				headers: new Headers(),
				ok: false,
				redirected: false,
				status: 0,
				statusText: "",
				type: "basic",
				url: "",
				clone: (): Response => {
					throw new Error("Function not implemented.");
				},
				body: null,
				bodyUsed: false,
				arrayBuffer: (): Promise<ArrayBuffer> => {
					throw new Error("Function not implemented.");
				},
				blob: (): Promise<Blob> => {
					throw new Error("Function not implemented.");
				},
				formData: (): Promise<FormData> => {
					throw new Error("Function not implemented.");
				},
				json: (): Promise<any> => {
					throw new Error("Function not implemented.");
				},
				text: (): Promise<string> => {
					throw new Error("Function not implemented.");
				},
			},
		}),
	).rejects.toThrow(ApiError);
});
