const ensureProtocol = (url, defaultProtocol) =>
	url.startsWith("http://") || url.startsWith("https://")
		? url
		: `${defaultProtocol}//${url}`;

const handleRedirect = (response, body, secretPath) => {
	const location = response.headers.get("location");
	if (!location) return new Response(body, response);

	// 2. 【修改】重定向时，保持路径中包含 SECRET_PATH
	const modifiedLocation = `${secretPath}/${encodeURIComponent(location.toString())}`;
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: {
			...response.headers,
			Location: modifiedLocation,
		},
	});
};

const replaceHost = (text, host, origin) => text.replace(host, origin);

const replaceRelativePaths = (text, protocol, host, origin, secretPath) =>
	text.replace(
		/((href|src|action)=["'])\/(?!\/)/g,
		`$1${protocol}//${host}${secretPath}/${origin}/`,
	);

// 4. 【修改】HTML 处理函数：服务端注入 <base> 标签
const handleHtmlContent = async (
	response,
	protocol,
	proxyHost,
	targetUrlStr,
	secretPath,
) => {
	let text = await response.text();

	// 1. 仍然执行原本的正则替换 (处理 href="/xxx" 这种根相对路径)
	// 注意：<base> 标签对以 "/" 开头的路径无效，所以这步正则必须保留
	text = replaceHost(text, proxyHost, new URL(targetUrlStr).host);
	text = replaceRelativePaths(
		text,
		protocol,
		proxyHost,
		new URL(targetUrlStr).origin,
		secretPath,
	);

	// 2. 【新增】计算 Base URL (解决 ../xxx 和 ./xxx 无效的问题)
	// 逻辑：找到目标 URL 的“目录层级”，拼接到代理路径后面
	const targetUrlObj = new URL(targetUrlStr);

	// 提取当前目录 (例如 https://site.com/a/b.html -> https://site.com/a/)
	// 即使 url 是 https://site.com/a/ (目录)，lastIndexOf 也是处理正确的
	const pathDir = targetUrlObj.href.substring(
		0,
		targetUrlObj.href.lastIndexOf("/") + 1,
	);

	// 构造代理用的 Base URL
	// 最终形态: https://你的域名/你的密码/https://目标网站/目录/
	const proxyBaseUrl = `${protocol}//${proxyHost}${secretPath}/${pathDir}`;

	// 3. 【修改】将 <base> 标签注入到 <head> 的最开始
	// 这样浏览器解析后续的 link/script/img 时，会自动基于这个 URL 计算路径
	const baseTag = `<base href="${proxyBaseUrl}">`;

	// 同时注入你的 JS 脚本
	const scriptTag = proxyScript(
		new URL(targetUrlStr).host,
		proxyHost,
		secretPath,
		proxyBaseUrl,
	);

	// 替换插入
	text = text.replace("<head>", `<head>${baseTag}${scriptTag}`);

	return text;
};

const filterHeaders = (headers, filterFunc) =>
	new Headers([...headers].filter(([name]) => filterFunc(name)));

const deleteCspHeaders = (headers) => {
	headers.delete("content-security-policy");
	headers.delete("content-security-policy-report-only");
	headers.delete("x-frame-options");
};

const setNoCacheHeaders = (headers) => headers.set("Cache-Control", "no-store");

const setCorsHeaders = (headers) => {
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set(
		"Access-Control-Allow-Methods",
		"GET, POST, PUT, DELETE, OPTIONS",
	);
	headers.set("Access-Control-Allow-Headers", "*");
	headers.set("Access-Control-Allow-Credentials", "true");
};

const cleanHeaders = (headers, targetHost) => {
	headers.set("Host", targetHost);
	headers.set("Origin", `https://${targetHost}`);
	headers.set("Referer", `https://${targetHost}/`);
	headers.delete("X-Forwarded-Host");
	headers.delete("Via");
};

const jsonResponse = (data, status) =>
	new Response(JSON.stringify(data), {
		status: status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});

// 【新增】辅助函数：解析 Cookie (用于会话救援)
const getCookieValue = (cookieHeader, cookieName) => {
	if (!cookieHeader) return null;
	const match = cookieHeader.match(new RegExp(`(^| )${cookieName}=([^;]+)`));
	if (match) return decodeURIComponent(match[2]);
	return null;
};

// 6. 【修改】首页 HTML，让表单提交时自动带上 SECRET_PATH
const getRootHtml = (secretPath) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
	<title>Proxy Everything</title>
	<link rel="icon" type="image/png" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body,
		html {
			height: 100%;
			margin: 0;
		}
		.background {
			background-image: url('https://imgapi.cn/bing.php?rand=true');
			background-size: cover;
			background-position: center;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.card {
			background-color: rgba(255, 255, 255, 0.8);
			transition: background-color 0.3s ease, box-shadow 0.3s ease;
		}
		.card:hover {
			background-color: rgba(255, 255, 255, 1);
			box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.3);
		}
		.input-field input[type=text] {
			color: #2c3e50;
		}
		.input-field input[type=text]:focus+label {
			color: #2c3e50 !important;
		}
		.input-field input[type=text]:focus {
			border-bottom: 1px solid #2c3e50 !important;
			box-shadow: 0 1px 0 0 #2c3e50 !important;
		}
	</style>
</head>
<body>
	<div class="background">
		<div class="container">
			<div class="row">
				<div class="col s12 m8 offset-m2 l6 offset-l3">
					<div class="card">
						<div class="card-content">
							<span class="card-title center-align"><i class="material-icons left">link</i>Proxy</span>
							<form id="urlForm" onsubmit="redirectToProxy(event)">
								<div class="input-field">
									<input type="text" id="targetUrl" placeholder="在此输入目标地址" required>
									<label for="targetUrl">目标地址</label>
								</div>
								<button type="submit"
									class="btn waves-effect waves-light teal darken-2 full-width">跳转</button>
							</form>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
	<script>
		function redirectToProxy(event) {
			event.preventDefault();
			const targetUrl = document.getElementById('targetUrl').value.trim();
			const currentOrigin = window.location.origin;
			const secretPath = '${secretPath}'; // 注入密码路径
			window.open(currentOrigin + secretPath + '/' + encodeURIComponent(targetUrl), '_blank');
		}
	</script>
</body>
</html>`;

// === 通用客户端注入脚本 (已升级为终极劫持版) ===
const proxyScript = (
	originalHost,
	proxyHost,
	secretPath,
	proxyBaseUrl,
) => `<script>
const SECRET_PATH = '${secretPath}';
const PROXY_HOST = '${proxyHost}';

// 核心：从浏览器地址栏还原出“当前真实的 Base URL”
function getRealCurrentUrl() {
	const currentLoc = window.location.href;
	const proxyPrefix = window.location.origin + SECRET_PATH + '/';

	// 如果当前地址包含代理前缀，则剥离它，获取真实目标的 URL
	if (currentLoc.startsWith(proxyPrefix)) {
		// 浏览器会自动 decode pathname，但为了保险我们手动处理一下
		// 这里提取出的就是 https://google.com/search?q=... 这种形式
		return decodeURIComponent(currentLoc.substring(proxyPrefix.length));
	}
	// 降级处理：如果找不到路径（比如刚加载时），使用传入的原始 Host
	return 'https://${originalHost}/';
}

function proxyUrl(url) {
	if (!url) return '';
	// 1. 静态资源/特殊协议检查
	if (typeof url !== 'string') {
		try { url = String(url); } catch (e) { return ''; }
	}
	if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#')) return url;

	// 2. 幂等性检查：如果已经是代理过的链接，直接返回
	if (url.includes(SECRET_PATH + '/')) return url;

	try {
		// 第一步：获取当前页面在“真实世界”中的 URL
		const realBase = getRealCurrentUrl();

		// 第二步：利用浏览器原生能力，计算出目标的绝对 URL
		const resolvedUrlObj = new URL(url, realBase);
		const resolvedTargetUrl = resolvedUrlObj.href;

		// 第三步：判断是否需要代理（防止代理了本站的内部资源）
		// 如果解析出来的域名就是代理服务器本身，且没有包含 SECRET_PATH，说明是误伤（极少情况）
		if (resolvedUrlObj.host === PROXY_HOST && !resolvedUrlObj.pathname.startsWith(SECRET_PATH)) {
			return url;
		}

		// 第四步：重新封装回代理格式
		// 格式：https://proxy.com/secret/https://target.com/path
		return window.location.origin + SECRET_PATH + '/' + resolvedTargetUrl;

		// === 核心逻辑修改结束 ===
	} catch (e) {
		// 发生解析错误（比如 url 不合法），原样返回
		console.warn('Proxy parsing failed for:', url, e);
		return url;
	}
}

// 1. 基础环境伪装
try {
	// 伪造 Referer 为目标域名 (解决防盗链)
	Object.defineProperty(document, 'referrer', {
		get: () => 'https://${originalHost}/',
		configurable: true
	});
} catch (e) { }

// 2. 注入 Base 标签 (最通用的相对路径处理方案)
if (!document.querySelector('base')) {
	const base = document.createElement('base');
	base.href = '${proxyBaseUrl}';
	document.head.prepend(base);
}

// === 表单提交劫持 ===
// 监听标准 submit 事件
document.addEventListener('submit', (e) => {
	const form = e.target;
	const rawAction = form.getAttribute('action');
	if (rawAction) {
		form.action = proxyUrl(rawAction);
	}
}, true);

// 【关键修复】劫持 form.submit() 方法
const nativeFormSubmit = HTMLFormElement.prototype.submit;
HTMLFormElement.prototype.submit = function () {
	const rawAction = this.getAttribute('action');
	if (rawAction) {
		this.action = proxyUrl(rawAction);
	}
	return nativeFormSubmit.call(this);
};

// === 导航劫持 ===
// 【关键修复】劫持 SPA 常用跳转 API
const nativeAssign = Location.prototype.assign;
const nativeReplace = Location.prototype.replace;
Location.prototype.assign = function (url) { return nativeAssign.call(this, proxyUrl(url)); };
Location.prototype.replace = function (url) { return nativeReplace.call(this, proxyUrl(url)); };

// === 底层 API 劫持 ===

// 劫持XMLHttpRequest
const nativeXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
	return nativeXHROpen.call(this, method, proxyUrl(url));
};

// 劫持fetch
const nativeFetch = window.fetch;
window.fetch = (input, init) => {
	if (typeof input === 'string') { input = proxyUrl(input); }
	else if (input?.url) { try { input = new Request(proxyUrl(String(input.url)), input); } catch (e) { } }
	return nativeFetch(input, init);
};

// 劫持动态元素属性
const nativeCreateElement = document.createElement;
document.createElement = function (tagName, options) {
	const el = nativeCreateElement.call(this, tagName, options);
	const tag = tagName.toLowerCase();
	// 增加 script 和 iframe 支持
	if (['a', 'img', 'script', 'link', 'iframe', 'form', 'input', 'video', 'audio', 'source', 'object', 'embed'].includes(tag)) {
		const nativeSetAttribute = el.setAttribute;
		el.setAttribute = function (name, value) {
			if (['href', 'src', 'action', 'data', 'poster'].includes(name)) { value = proxyUrl(value); }
			return nativeSetAttribute.call(this, name, value);
		};

		// 统一劫持 src 属性 (img, iframe, script)
		if (tag === 'img' || tag === 'iframe' || tag === 'script') {
			// 获取对应的原型，确保兼容性
			let proto = HTMLElement.prototype;
			if (tag === 'img') proto = HTMLImageElement.prototype;
			if (tag === 'iframe') proto = HTMLIFrameElement.prototype;
			if (tag === 'script') proto = HTMLScriptElement.prototype;

			const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
			if (descriptor?.configurable) {
				Object.defineProperty(el, 'src', {
					get: descriptor.get,
					set: (value) => { descriptor.set.call(el, proxyUrl(value)); },
					configurable: true
				});
			}
		}
	}
	return el;
};

// 劫持history API
const nativePushState = history.pushState;
history.pushState = function (state, title, url) {
	if (url) return nativePushState.call(this, state, title, proxyUrl(url));
	return nativePushState.call(this, state, title, url);
};

const nativeReplaceState = history.replaceState;
history.replaceState = function (state, title, url) {
	if (url) return nativeReplaceState.call(this, state, title, proxyUrl(url));
	return nativeReplaceState.call(this, state, title, url);
};

// 劫持WebSocket
const nativeWebSocket = WebSocket;
window.WebSocket = function (url, protocols) {
	let proxiedUrl = proxyUrl(String(url));
	// 将 HTTP 协议头转回 WS 协议头
	if (proxiedUrl.startsWith('http://')) {
		proxiedUrl = proxiedUrl.replace('http://', 'ws://');
	} else if (proxiedUrl.startsWith('https://')) {
		proxiedUrl = proxiedUrl.replace('https://', 'wss://');
	}
	return new nativeWebSocket(proxiedUrl, protocols);
};

// 劫持Window.open
const nativeWindowOpen = window.open;
window.open = function (url, target, features) {
	if (url) url = proxyUrl(url);
	return nativeWindowOpen.call(this, url, target, features);
};
</script>`;

export default {
	async fetch(request, env, ctx) {
		// 地理位置验证
		const allowCountries = env.ALLOW_COUNTRIES?.split(",").map((c) => c.trim().toUpperCase());
		if (allowCountries && !allowCountries.includes("*") && !allowCountries.includes(request.cf.country)) {
			return new Response('Access denied', { status: 403 });
		}

		// 前缀路径
		const secretPath = env.SECRET_PATH || "/my-super-secret-password-change-me";

		if (request.method === "OPTIONS") {
			const headers = new Headers();
			setCorsHeaders(headers);
			return new Response(null, { headers });
		}

		try {
			const url = new URL(request.url);

			// 1. 验证安全路径
			if (!url.pathname.startsWith(secretPath)) {
				// === 终极迷路救援 (Cookie Session Rescue) ===
				// 如果请求没有带密码路径，尝试从 Cookie 找回之前的目标
				const cookieHeader = request.headers.get("Cookie");
				const sessionBaseUrl = getCookieValue(cookieHeader, "__proxy_session");

				if (sessionBaseUrl) {
					try {
						// 解析出原本应该访问的目标 URL
						// 例如：把 /socket.io/ 拼接到 https://target.com/ 上
						const fixedTargetUrlObj = new URL(url.pathname, sessionBaseUrl);
						// 补上 search 参数 (?a=1)
						fixedTargetUrlObj.search = url.search;

						// 【新增修复】WebSocket 静默救援 (解决 302 导致 WS 断开的问题)
						if (request.headers.get('Upgrade') === 'websocket') {
							const targetUrlStr = fixedTargetUrlObj.href;

							// 复用 WebSocket 转发逻辑
							const wsHeaders = filterHeaders(request.headers, (name) => !name.startsWith("cf-"));
							cleanHeaders(wsHeaders, fixedTargetUrlObj.hostname);

							// 直接转发，不返回 302
							return fetch(targetUrlStr, {
								method: 'GET',
								headers: wsHeaders,
								redirect: 'manual'
							});
						}

						// 普通 HTTP 请求仍然使用重定向救援
						const fixedUrl = `${url.protocol}//${url.host}${secretPath}/${fixedTargetUrlObj.href}`;
						return Response.redirect(fixedUrl, 302);
					} catch (_e) { }
				}

				// === 备用救援 (Referer Rescue) ===
				const referer = request.headers.get("Referer");
				if (referer) {
					try {
						const refererObj = new URL(referer);
						if (refererObj.pathname.startsWith(secretPath)) {
							const pathParts = refererObj.pathname
								.replace(secretPath, "")
								.slice(1);
							const targetUrlStr = decodeURIComponent(pathParts);
							const targetOriginMatch =
								targetUrlStr.match(/^(https?:\/\/[^/]+)/);
							if (targetOriginMatch) {
								const targetOrigin = targetOriginMatch[1];
								const fixedUrl = `${url.protocol}//${url.host}${secretPath}/${targetOrigin}${url.pathname}${url.search}`;
								return Response.redirect(fixedUrl, 302);
							}
						}
					} catch (_e) { }
				}

				return new Response("404 Not Found", { status: 404 });
			}

			// 2. 正常处理逻辑
			const actualPath = url.pathname.replace(secretPath, "");

			if (actualPath === "" || actualPath === "/") {
				return new Response(getRootHtml(secretPath), {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}

			// 提取目标URL
			let targetUrlStr = decodeURIComponent(actualPath.slice(1));
			targetUrlStr = ensureProtocol(targetUrlStr, url.protocol);
			targetUrlStr += url.search;

			// 【新增】提取目标 Origin 用于写入 Session
			const targetUrlObj = new URL(targetUrlStr);

			// 【新增】WebSocket 专用处理通道
			if (request.headers.get("Upgrade") === "websocket") {
				// 1. 构建 WebSocket 请求头
				const wsHeaders = filterHeaders(request.headers, (name) => !name.startsWith("cf-"));
				cleanHeaders(wsHeaders, targetUrlObj.hostname); // 复用之前的清理函数

				// 2. 直接转发，不做任何处理
				return fetch(targetUrlStr, {
					method: "GET",
					headers: wsHeaders,
					redirect: "manual",
				});
			}

			// 构建新请求头
			const newHeaders = filterHeaders(
				request.headers,
				(name) => !name.startsWith("cf-"),
			);
			cleanHeaders(newHeaders, targetUrlObj.hostname);

			const modifiedRequest = new Request(targetUrlStr, {
				headers: newHeaders,
				method: request.method,
				body: request.body,
				redirect: "manual",
			});

			// 发起请求
			const response = await fetch(modifiedRequest);
			let body = response.body;

			// 处理重定向
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				return handleRedirect(response, body, secretPath);
			}

			// 构建响应
			let modifiedResponse = null;

			// 检查响应类型
			const contentType = response.headers.get("Content-Type");
			const isHtml = contentType?.includes("text/html");

			// 处理HTML内容
			if (isHtml) {
				body = await handleHtmlContent(
					response,
					url.protocol,
					url.host,
					targetUrlStr,
					secretPath,
				);
			}

			// 构建最终响应
			modifiedResponse = new Response(body, response);
			setNoCacheHeaders(modifiedResponse.headers);
			setCorsHeaders(modifiedResponse.headers);
			deleteCspHeaders(modifiedResponse.headers);

			// 【关键修复】只在访问 HTML 页面时更新 Session Cookie
			// 防止 CSS/图片/JS (通常来自 CDN) 覆盖 Session Origin，导致后续跳转到 CDN 域名
			if (isHtml) {
				modifiedResponse.headers.append(
					"Set-Cookie",
					`__proxy_session=${encodeURIComponent(targetUrlStr)}; Path=/; SameSite=Lax; HttpOnly`,
				);
			}

			return modifiedResponse;
		} catch (error) {
			return jsonResponse({ error: error.message }, 500);
		}
	},
};
