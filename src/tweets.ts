import { addApiFeatures, requestApi } from "./api";
import { apiRequestFactory } from "./api-data";
import type { TwitterAuth } from "./auth";
import { AuthenticationError } from "./errors";
import { getUserIdByScreenName } from "./profile";
import { updateCookieJar } from "./requests";
import { getTweetTimeline } from "./timeline-async";
import { type ListTimeline, parseListTimelineTweets } from "./timeline-list";
import type { LegacyTweetRaw, QueryTweetsResponse } from "./timeline-v1";
import {
	type ThreadedConversation,
	type TimelineEntryItemContentRaw,
	type TimelineV2,
	parseThreadedConversation,
	parseTimelineEntryItemContentRaw,
	parseTimelineTweetsV2,
} from "./timeline-v2";

export interface Mention {
	id: string;
	username?: string;
	name?: string;
}

export interface Photo {
	id: string;
	url: string;
	alt_text: string | undefined;
}

export interface Video {
	id: string;
	preview: string;
	url?: string;
}

export interface PlaceRaw {
	id?: string;
	place_type?: string;
	name?: string;
	full_name?: string;
	country_code?: string;
	country?: string;
	bounding_box?: {
		type?: string;
		coordinates?: number[][][];
	};
}

/**
 * A parsed Tweet object.
 */
export interface Tweet {
	__raw_UNSTABLE?: LegacyTweetRaw;
	bookmarkCount?: number;
	conversationId?: string;
	hashtags: string[];
	html?: string;
	id?: string;
	inReplyToStatus?: Tweet;
	inReplyToStatusId?: string;
	isEdited?: boolean;
	versions?: string[];
	isQuoted?: boolean;
	isPin?: boolean;
	isReply?: boolean;
	isRetweet?: boolean;
	isSelfThread?: boolean;
	likes?: number;
	name?: string;
	mentions: Mention[];
	permanentUrl?: string;
	photos: Photo[];
	place?: PlaceRaw;
	quotedStatus?: Tweet;
	quotedStatusId?: string;
	replies?: number;
	retweets?: number;
	retweetedStatus?: Tweet;
	retweetedStatusId?: string;
	text?: string;
	thread: Tweet[];
	timeParsed?: Date;
	timestamp?: number;
	urls: string[];
	userId?: string;
	username?: string;
	videos: Video[];
	views?: number;
	sensitiveContent?: boolean;
}

export type TweetQuery =
	| Partial<Tweet>
	| ((tweet: Tweet) => boolean | Promise<boolean>);

export const features = addApiFeatures({
	interactive_text_enabled: true,
	longform_notetweets_inline_media_enabled: false,
	responsive_web_text_conversations_enabled: false,
	tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
	vibe_api_enabled: false,
});

export async function fetchTweets(
	userId: string,
	maxTweets: number,
	cursor: string | undefined,
	auth: TwitterAuth,
): Promise<QueryTweetsResponse> {
	if (maxTweets > 200) {
		maxTweets = 200;
	}

	const userTweetsRequest = apiRequestFactory.createUserTweetsRequest();
	userTweetsRequest.variables.userId = userId;
	userTweetsRequest.variables.count = maxTweets;
	userTweetsRequest.variables.includePromotedContent = false; // true on the website

	if (cursor != null && cursor != "") {
		userTweetsRequest.variables["cursor"] = cursor;
	}

	const res = await requestApi<TimelineV2>(
		userTweetsRequest.toRequestUrl(),
		auth,
	);

	if (!res.success) {
		throw res.err;
	}

	return parseTimelineTweetsV2(res.value);
}

export async function fetchTweetsAndReplies(
	userId: string,
	maxTweets: number,
	cursor: string | undefined,
	auth: TwitterAuth,
): Promise<QueryTweetsResponse> {
	if (maxTweets > 40) {
		maxTweets = 40;
	}

	const userTweetsRequest =
		apiRequestFactory.createUserTweetsAndRepliesRequest();
	userTweetsRequest.variables.userId = userId;
	userTweetsRequest.variables.count = maxTweets;
	userTweetsRequest.variables.includePromotedContent = false; // true on the website

	if (cursor != null && cursor != "") {
		userTweetsRequest.variables["cursor"] = cursor;
	}

	const res = await requestApi<TimelineV2>(
		userTweetsRequest.toRequestUrl(),
		auth,
	);

	if (!res.success) {
		throw res.err;
	}

	return parseTimelineTweetsV2(res.value);
}

// Function to create a quote tweet
export async function createQuoteTweetRequest(
	text: string,
	quotedTweetId: string,
	auth: TwitterAuth,
	mediaData?: { data: Buffer; mediaType: string }[],
) {
	const onboardingTaskUrl = "https://api.twitter.com/1.1/onboarding/task.json";

	// Retrieve necessary cookies and tokens
	const cookies = await auth.cookieJar().getCookies(onboardingTaskUrl);
	const xCsrfToken = cookies.find((cookie) => cookie.key === "ct0");

	const headers = new Headers({
		authorization: `Bearer ${(auth as any).bearerToken}`,
		cookie: await auth.cookieJar().getCookieString(onboardingTaskUrl),
		"content-type": "application/json",
		"User-Agent":
			"Mozilla/5.0 (Linux; Android 11; Nokia G20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.88 Mobile Safari/537.36",
		"x-guest-token": (auth as any).guestToken,
		"x-twitter-auth-type": "OAuth2Client",
		"x-twitter-active-user": "yes",
		"x-csrf-token": xCsrfToken?.value as string,
	});

	// Construct variables for the GraphQL request
	const variables: Record<string, any> = {
		tweet_text: text,
		dark_request: false,
		attachment_url: `https://twitter.com/twitter/status/${quotedTweetId}`,
		media: {
			media_entities: [],
			possibly_sensitive: false,
		},
		semantic_annotation_ids: [],
	};

	// Handle media uploads if any media data is provided
	if (mediaData && mediaData.length > 0) {
		const mediaIds = await Promise.all(
			mediaData.map(({ data, mediaType }) =>
				uploadMedia(data, auth, mediaType),
			),
		);

		variables.media.media_entities = mediaIds.map((id) => ({
			media_id: id,
			tagged_users: [],
		}));
	}

	// Send the GraphQL request to create a quote tweet
	const response = await fetch(
		"https://twitter.com/i/api/graphql/a1p9RWpkYKBjWv_I3WzS-A/CreateTweet",
		{
			headers,
			body: JSON.stringify({
				variables,
				features: {
					interactive_text_enabled: true,
					longform_notetweets_inline_media_enabled: false,
					responsive_web_text_conversations_enabled: false,
					tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
					vibe_api_enabled: false,
					rweb_lists_timeline_redesign_enabled: true,
					responsive_web_graphql_exclude_directive_enabled: true,
					verified_phone_label_enabled: false,
					creator_subscriptions_tweet_preview_api_enabled: true,
					responsive_web_graphql_timeline_navigation_enabled: true,
					responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
					tweetypie_unmention_optimization_enabled: true,
					responsive_web_edit_tweet_api_enabled: true,
					graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
					view_counts_everywhere_api_enabled: true,
					longform_notetweets_consumption_enabled: true,
					tweet_awards_web_tipping_enabled: false,
					freedom_of_speech_not_reach_fetch_enabled: true,
					standardized_nudges_misinfo: true,
					longform_notetweets_rich_text_read_enabled: true,
					responsive_web_enhance_cards_enabled: false,
					subscriptions_verification_info_enabled: true,
					subscriptions_verification_info_reason_enabled: true,
					subscriptions_verification_info_verified_since_enabled: true,
					super_follow_badge_privacy_enabled: false,
					super_follow_exclusive_tweet_notifications_enabled: false,
					super_follow_tweet_api_enabled: false,
					super_follow_user_api_enabled: false,
					android_graphql_skip_api_media_color_palette: false,
					creator_subscriptions_subscription_count_enabled: false,
					blue_business_profile_image_shape_enabled: false,
					unified_cards_ad_metadata_container_dynamic_card_content_query_enabled: false,
					rweb_video_timestamps_enabled: true,
					c9s_tweet_anatomy_moderator_badge_enabled: true,
					responsive_web_twitter_article_tweet_consumption_enabled: false,
				},
				fieldToggles: {},
			}),
			method: "POST",
		},
	);

	// Update the cookie jar with any new cookies from the response
	await updateCookieJar(auth.cookieJar(), response.headers);

	// Check for errors in the response
	if (!response.ok) {
		throw new Error(await response.text());
	}

	return response;
}

interface MediaUploadResponse {
	media_id_string: string;
	size: number;
	expires_after_secs: number;
	image: {
		image_type: string;
		w: number;
		h: number;
	};
}

async function uploadMedia(
	mediaData: Buffer,
	auth: TwitterAuth,
	mediaType: string,
): Promise<string> {
	const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";

	// Get authentication headers
	const cookies = await auth.cookieJar().getCookies(uploadUrl);
	const xCsrfToken = cookies.find((cookie) => cookie.key === "ct0");
	const headers = new Headers({
		authorization: `Bearer ${(auth as any).bearerToken}`,
		cookie: await auth.cookieJar().getCookieString(uploadUrl),
		"x-csrf-token": xCsrfToken?.value as string,
	});

	// Detect if media is a video based on mediaType
	const isVideo = mediaType.startsWith("video/");

	if (isVideo) {
		// Handle video upload using chunked media upload
		const mediaId = await uploadVideoInChunks(mediaData, mediaType);
		return mediaId;
	}

	// Function to upload video in chunks
	async function uploadVideoInChunks(
		mediaData: Buffer,
		mediaType: string,
	): Promise<string> {
		// Initialize upload
		const initParams = new URLSearchParams();
		initParams.append("command", "INIT");
		initParams.append("media_type", mediaType);
		initParams.append("total_bytes", mediaData.length.toString());

		const initResponse = await fetch(uploadUrl, {
			method: "POST",
			headers,
			body: initParams,
		});

		if (!initResponse.ok) {
			throw new Error(await initResponse.text());
		}

		const initData = await initResponse.json();
		const mediaId = initData.media_id_string;

		// Append upload in chunks
		const segmentSize = 5 * 1024 * 1024; // 5 MB per chunk
		let segmentIndex = 0;
		for (let offset = 0; offset < mediaData.length; offset += segmentSize) {
			const chunk = mediaData.slice(offset, offset + segmentSize);

			const appendForm = new FormData();
			appendForm.append("command", "APPEND");
			appendForm.append("media_id", mediaId);
			appendForm.append("segment_index", segmentIndex.toString());
			appendForm.append("media", new Blob([chunk]));

			const appendResponse = await fetch(uploadUrl, {
				method: "POST",
				headers,
				body: appendForm,
			});

			if (!appendResponse.ok) {
				throw new Error(await appendResponse.text());
			}

			segmentIndex++;
		}

		// Finalize upload
		const finalizeParams = new URLSearchParams();
		finalizeParams.append("command", "FINALIZE");
		finalizeParams.append("media_id", mediaId);

		const finalizeResponse = await fetch(uploadUrl, {
			method: "POST",
			headers,
			body: finalizeParams,
		});

		if (!finalizeResponse.ok) {
			throw new Error(await finalizeResponse.text());
		}

		const finalizeData = await finalizeResponse.json();

		// Check processing status for videos
		if (finalizeData.processing_info) {
			await checkUploadStatus(mediaId);
		}

		return mediaId;
	}

	// Function to check upload status
	async function checkUploadStatus(mediaId: string): Promise<void> {
		let processing = true;
		while (processing) {
			await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

			const statusParams = new URLSearchParams();
			statusParams.append("command", "STATUS");
			statusParams.append("media_id", mediaId);

			const statusResponse = await fetch(
				`${uploadUrl}?${statusParams.toString()}`,
				{
					method: "GET",
					headers,
				},
			);

			if (!statusResponse.ok) {
				throw new Error(await statusResponse.text());
			}

			const statusData = await statusResponse.json();
			const state = statusData.processing_info.state;

			if (state === "succeeded") {
				processing = false;
			} else if (state === "failed") {
				throw new Error("Video processing failed");
			}
		}
	}

	// Handle image upload
	const form = new FormData();
	form.append(
		"media",
		new Blob([mediaData], {
			type: mediaType,
		}),
	);

	const response = await fetch(uploadUrl, {
		method: "POST",
		headers,
		body: form,
	});

	await updateCookieJar(auth.cookieJar(), response.headers);

	if (!response.ok) {
		throw new Error(await response.text());
	}

	const data: MediaUploadResponse = await response.json();
	return data.media_id_string;
}

export async function createCreateTweetRequest(
	text: string,
	auth: TwitterAuth,
	tweetId?: string,
	mediaData?: { data: Buffer; mediaType: string }[],
	hideLinkPreview = false,
) {
	const onboardingTaskUrl = "https://api.twitter.com/1.1/onboarding/task.json";

	const cookies = await auth.cookieJar().getCookies(onboardingTaskUrl);
	const xCsrfToken = cookies.find((cookie) => cookie.key === "ct0");

	//@ ts-expect-error - This is a private API.
	const headers = new Headers({
		authorization: `Bearer ${(auth as any).bearerToken}`,
		cookie: await auth.cookieJar().getCookieString(onboardingTaskUrl),
		"content-type": "application/json",
		"User-Agent":
			"Mozilla/5.0 (Linux; Android 11; Nokia G20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.88 Mobile Safari/537.36",
		"x-guest-token": (auth as any).guestToken,
		"x-twitter-auth-type": "OAuth2Client",
		"x-twitter-active-user": "yes",
		"x-twitter-client-language": "en",
		"x-csrf-token": xCsrfToken?.value as string,
	});

	const variables: Record<string, any> = {
		tweet_text: text,
		dark_request: false,
		media: {
			media_entities: [],
			possibly_sensitive: false,
		},
		semantic_annotation_ids: [],
	};

	if (hideLinkPreview) {
		variables["card_uri"] = "tombstone://card";
	}

	if (mediaData && mediaData.length > 0) {
		const mediaIds = await Promise.all(
			mediaData.map(({ data, mediaType }) =>
				uploadMedia(data, auth, mediaType),
			),
		);

		variables.media.media_entities = mediaIds.map((id) => ({
			media_id: id,
			tagged_users: [],
		}));
	}

	if (tweetId) {
		variables.reply = { in_reply_to_tweet_id: tweetId };
	}

	const response = await fetch(
		"https://twitter.com/i/api/graphql/a1p9RWpkYKBjWv_I3WzS-A/CreateTweet",
		{
			headers,
			body: JSON.stringify({
				variables,
				features: {
					interactive_text_enabled: true,
					longform_notetweets_inline_media_enabled: false,
					responsive_web_text_conversations_enabled: false,
					tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
					vibe_api_enabled: false,
					rweb_lists_timeline_redesign_enabled: true,
					responsive_web_graphql_exclude_directive_enabled: true,
					verified_phone_label_enabled: false,
					creator_subscriptions_tweet_preview_api_enabled: true,
					responsive_web_graphql_timeline_navigation_enabled: true,
					responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
					tweetypie_unmention_optimization_enabled: true,
					responsive_web_edit_tweet_api_enabled: true,
					graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
					view_counts_everywhere_api_enabled: true,
					longform_notetweets_consumption_enabled: true,
					tweet_awards_web_tipping_enabled: false,
					freedom_of_speech_not_reach_fetch_enabled: true,
					standardized_nudges_misinfo: true,
					longform_notetweets_rich_text_read_enabled: true,
					responsive_web_enhance_cards_enabled: false,
					subscriptions_verification_info_enabled: true,
					subscriptions_verification_info_reason_enabled: true,
					subscriptions_verification_info_verified_since_enabled: true,
					super_follow_badge_privacy_enabled: false,
					super_follow_exclusive_tweet_notifications_enabled: false,
					super_follow_tweet_api_enabled: false,
					super_follow_user_api_enabled: false,
					android_graphql_skip_api_media_color_palette: false,
					creator_subscriptions_subscription_count_enabled: false,
					blue_business_profile_image_shape_enabled: false,
					unified_cards_ad_metadata_container_dynamic_card_content_query_enabled: false,
					rweb_video_timestamps_enabled: false,
					c9s_tweet_anatomy_moderator_badge_enabled: false,
					responsive_web_twitter_article_tweet_consumption_enabled: false,
				},
				fieldToggles: {},
			}),
			method: "POST",
		},
	);

	await updateCookieJar(auth.cookieJar(), response.headers);

	// check for errors
	if (!response.ok) {
		throw new Error(await response.text());
	}

	return response;
}

export async function fetchListTweets(
	listId: string,
	maxTweets: number,
	cursor: string | undefined,
	auth: TwitterAuth,
): Promise<QueryTweetsResponse> {
	if (maxTweets > 200) {
		maxTweets = 200;
	}

	const listTweetsRequest = apiRequestFactory.createListTweetsRequest();
	listTweetsRequest.variables.listId = listId;
	listTweetsRequest.variables.count = maxTweets;

	if (cursor != null && cursor != "") {
		listTweetsRequest.variables["cursor"] = cursor;
	}

	const res = await requestApi<ListTimeline>(
		listTweetsRequest.toRequestUrl(),
		auth,
	);

	if (!res.success) {
		throw res.err;
	}

	return parseListTimelineTweets(res.value);
}

export function getTweets(
	user: string,
	maxTweets: number,
	auth: TwitterAuth,
): AsyncGenerator<Tweet, void> {
	return getTweetTimeline(user, maxTweets, async (q, mt, c) => {
		const userIdRes = await getUserIdByScreenName(q, auth);

		if (!userIdRes.success) {
			throw userIdRes.err;
		}

		const { value: userId } = userIdRes;

		return fetchTweets(userId, mt, c, auth);
	});
}

export function getTweetsByUserId(
	userId: string,
	maxTweets: number,
	auth: TwitterAuth,
): AsyncGenerator<Tweet, void> {
	return getTweetTimeline(userId, maxTweets, (q, mt, c) => {
		return fetchTweets(q, mt, c, auth);
	});
}

export function getTweetsAndReplies(
	user: string,
	maxTweets: number,
	auth: TwitterAuth,
): AsyncGenerator<Tweet, void> {
	return getTweetTimeline(user, maxTweets, async (q, mt, c) => {
		const userIdRes = await getUserIdByScreenName(q, auth);

		if (!userIdRes.success) {
			throw userIdRes.err;
		}

		const { value: userId } = userIdRes;

		return fetchTweetsAndReplies(userId, mt, c, auth);
	});
}

export function getTweetsAndRepliesByUserId(
	userId: string,
	maxTweets: number,
	auth: TwitterAuth,
): AsyncGenerator<Tweet, void> {
	return getTweetTimeline(userId, maxTweets, (q, mt, c) => {
		return fetchTweetsAndReplies(q, mt, c, auth);
	});
}

export async function fetchLikedTweets(
	userId: string,
	maxTweets: number,
	cursor: string | undefined,
	auth: TwitterAuth,
): Promise<QueryTweetsResponse> {
	if (!(await auth.isLoggedIn())) {
		throw new AuthenticationError(
			"Scraper is not logged-in for fetching liked tweets.",
		);
	}

	if (maxTweets > 200) {
		maxTweets = 200;
	}

	const userTweetsRequest = apiRequestFactory.createUserLikedTweetsRequest();
	userTweetsRequest.variables.userId = userId;
	userTweetsRequest.variables.count = maxTweets;
	userTweetsRequest.variables.includePromotedContent = false; // true on the website

	if (cursor != null && cursor != "") {
		userTweetsRequest.variables["cursor"] = cursor;
	}

	const res = await requestApi<TimelineV2>(
		userTweetsRequest.toRequestUrl(),
		auth,
	);

	if (!res.success) {
		throw res.err;
	}

	return parseTimelineTweetsV2(res.value);
}

export function getLikedTweets(
	user: string,
	maxTweets: number,
	auth: TwitterAuth,
): AsyncGenerator<Tweet, void> {
	return getTweetTimeline(user, maxTweets, async (q, mt, c) => {
		const userIdRes = await getUserIdByScreenName(q, auth);

		if (!userIdRes.success) {
			throw userIdRes.err;
		}

		const { value: userId } = userIdRes;

		return fetchLikedTweets(userId, mt, c, auth);
	});
}

export async function getTweetWhere(
	tweets: AsyncIterable<Tweet>,
	query: TweetQuery,
): Promise<Tweet | null> {
	const isCallback = typeof query === "function";

	for await (const tweet of tweets) {
		const matches = isCallback
			? await query(tweet)
			: checkTweetMatches(tweet, query);

		if (matches) {
			return tweet;
		}
	}

	return null;
}

export async function getTweetsWhere(
	tweets: AsyncIterable<Tweet>,
	query: TweetQuery,
): Promise<Tweet[]> {
	const isCallback = typeof query === "function";
	const filtered = [];

	for await (const tweet of tweets) {
		const matches = isCallback ? query(tweet) : checkTweetMatches(tweet, query);

		if (!matches) continue;
		filtered.push(tweet);
	}

	return filtered;
}

function checkTweetMatches(tweet: Tweet, options: Partial<Tweet>): boolean {
	return Object.keys(options).every((k) => {
		const key = k as keyof Tweet;
		return tweet[key] === options[key];
	});
}

export async function getLatestTweet(
	user: string,
	includeRetweets: boolean,
	max: number,
	auth: TwitterAuth,
): Promise<Tweet | null | void> {
	const timeline = getTweets(user, max, auth);

	// No point looping if max is 1, just use first entry.
	return max === 1
		? (await timeline.next()).value
		: await getTweetWhere(timeline, { isRetweet: includeRetweets });
}

export interface TweetResultByRestId {
	data?: TimelineEntryItemContentRaw;
}

export async function getTweet(
	id: string,
	auth: TwitterAuth,
): Promise<Tweet | null> {
	const tweetDetailRequest = apiRequestFactory.createTweetDetailRequest();
	tweetDetailRequest.variables.focalTweetId = id;

	const res = await requestApi<ThreadedConversation>(
		tweetDetailRequest.toRequestUrl(),
		auth,
	);

	if (!res.success) {
		throw res.err;
	}

	if (!res.value) {
		return null;
	}

	const tweets = parseThreadedConversation(res.value);
	return tweets.find((tweet) => tweet.id === id) ?? null;
}

export async function getTweetAnonymous(
	id: string,
	auth: TwitterAuth,
): Promise<Tweet | null> {
	const tweetResultByRestIdRequest =
		apiRequestFactory.createTweetResultByRestIdRequest();
	tweetResultByRestIdRequest.variables.tweetId = id;

	const res = await requestApi<TweetResultByRestId>(
		tweetResultByRestIdRequest.toRequestUrl(),
		auth,
	);

	if (!res.success) {
		throw res.err;
	}

	if (!res.value.data) {
		return null;
	}

	return parseTimelineEntryItemContentRaw(res.value.data, id);
}
