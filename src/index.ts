export interface Env {
	APP_JSON: KVNamespace;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		if (pathname === '/list-keys') {
			// Return all keys in KV as JSON
			try {
				const allKeys = await listAllKeys(env.APP_JSON);
				return new Response(JSON.stringify(allKeys), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (err) {
				let errorMessage = 'Unknown error';
				if (err && typeof err === 'object' && 'message' in err) {
					errorMessage = (err as { message: string }).message;
				}
				return new Response(JSON.stringify({ error: 'Failed to list keys', details: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Existing code to serve JSON by key:
		let key = pathname.replace(/^\/+/, '');
		if (!key.endsWith('.json')) key += '.json';

		const object = await env.APP_JSON.getWithMetadata(key, { type: 'text' });

		if (!object || !object.value) {
			return new Response(JSON.stringify({ error: `JSON not found for key: ${key}` }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const jsonString = object.value;
		const etag = `"${await sha1(jsonString)}"`;

		const ifNoneMatch = request.headers
			.get('If-None-Match')
			?.replace(/^W\//, '')
			.replace(/^"+|"+$/g, '');
		const normalizedEtag = etag.replace(/^"+|"+$/g, '');

		if (ifNoneMatch === normalizedEtag) {
			return new Response(null, {
				status: 304,
				headers: {
					ETag: etag,
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Expose-Headers': 'ETag',
				},
			});
		}

		return new Response(jsonString, {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'public, max-age=300',
				ETag: etag,
			},
		});
	},
};

// Helper: SHA-1 hash function
async function sha1(data: string): Promise<string> {
	const encoder = new TextEncoder();
	const dataBuffer = encoder.encode(data);
	const hashBuffer = await crypto.subtle.digest('SHA-1', dataBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper: List all keys in a KV namespace (handling pagination)
async function listAllKeys(kv: KVNamespace): Promise<string[]> {
	let keys: string[] = [];
	let cursor: string | undefined = undefined;

	do {
		const listResponse: { keys: { name: string }[]; cursor?: string } = await kv.list({ cursor, limit: 1000 });
		keys = keys.concat(listResponse.keys.map((k) => k.name));
		cursor = listResponse.cursor;
	} while (cursor);

	return keys;
}
