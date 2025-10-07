(function(){
    // ===============================
    // Configuration
    // ===============================
    // const OPENAI_API_KEY = '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';
    const OPENAI_API_KEY = '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';
    const CHAT_MODEL = 'meta-llama/llama-4-maverick:free';
    const ACTIVITY_THRESHOLD = 60 * 1000; // 60 seconds in ms

    // ===============================
    // Cookie Helpers
    // ===============================
    function setSessionCookie(cookieName, value) {
        // Session cookie: no "expires" -> cleared when browser closes
        document.cookie = cookieName + '=' + encodeURIComponent(value) + '; path=/';
    }
    function getCookie(name) {
        const cookie = document.cookie.split('; ').find(row => row.startsWith(name + '='));
        return cookie ? decodeURIComponent(cookie.split('=')[1]) : null;
    }

    // ===============================
    // Load / Init Session Data
    // ===============================
    console.log('🔧 Navigation Tracker: Initializing.');
    let sessionData = { pages: [], totalTime: 0, apiCalled: false, recommendations: '', emailCapture: { submittedUrls: [], dismissedAtByUrl: {} } };
    const saved = getCookie('sessionData');
    if (saved) {
        try { 
            sessionData = JSON.parse(saved);
            console.log('📊 Navigation Tracker: Loaded existing session data:', sessionData);
        } catch (e) {
            console.warn('⚠️ Navigation Tracker: Failed to parse saved session data:', e);
        }
    } else {
        console.log('🆕 Navigation Tracker: Starting new session');
    }

    // ===============================
    // Track Current Page Visit
    // ===============================
    const pageInfo = { url: window.location.href, title: document.title, time: 0 };
    sessionData.pages.push(pageInfo);
    console.log('📄 Navigation Tracker: Tracking page:', pageInfo);

    let lastTimestamp = performance.now(); // high-resolution timer
    let pageVisible = (document.visibilityState === 'visible');
    let isFetchingRecommendations = false;
    let emailReopenTimeoutId = null;
    console.log('⏱️ Navigation Tracker: Started timing, page visible:', pageVisible);

    // If API was already called in a previous page this session, show the button immediately
    if (sessionData.apiCalled) {
        ensureRecommendationsButton();
    }

    // If we already have saved recommendations in cookie, recreate the hidden container
    if (sessionData.recommendations && !document.getElementById('api-response-container')) {
        const container = document.createElement('div');
        container.id = 'api-response-container';
        container.style.display = 'none';
        container.innerHTML = sessionData.recommendations;
        document.body.appendChild(container);
        console.log('📦 Navigation Tracker: Restored response container from cookie');
        try { attachRecommendationClickListeners(); } catch(e) { console.warn('⚠️ attachRecommendationClickListeners call failed', e); }
    }

    // ===============================
    // Email Capture: Trigger if current page is a recommended URL
    // ===============================
    try {
        console.log('🔍 Email Capture: Trigger if current page is a recommended URL');
        maybeInitEmailCaptureForThisPage();
    } catch (err) {
        console.warn('⚠️ Navigation Tracker: Email-capture init failed:', err);
    }

    // ===============================
    // Continuous Threshold Check
    // ===============================
    setInterval(() => {
        const now = performance.now();
        if (pageVisible) {
            // Update time continuously while page is visible
            const delta = now - lastTimestamp;
            pageInfo.time += delta;
            sessionData.totalTime += delta;
            lastTimestamp = now;
            
            // Save updated data
            setSessionCookie('sessionData', JSON.stringify(sessionData));
            
            // Check threshold regardless of visibility state
            checkThreshold();
        }
    }, 30000); // Check every 30 seconds

    // ===============================
    // Threshold Check
    // ===============================
    function checkThreshold() {
        // console.log('🎯 Navigation Tracker: Checking threshold - Total time:', Math.round(sessionData.totalTime/1000) + 's, Threshold:', Math.round(ACTIVITY_THRESHOLD/1000) + 's, API called:', sessionData.apiCalled);
        if (!sessionData.apiCalled && sessionData.totalTime >= ACTIVITY_THRESHOLD) {
            console.log('🚀 Navigation Tracker: Threshold reached! Calling API.');
            sessionData.apiCalled = true;
            setSessionCookie('sessionData', JSON.stringify(sessionData));
            // Ensure the recommendations button is visible as soon as threshold is met
            ensureRecommendationsButton();
            sendDataToOpenAI();
        }
    }

    // ===============================
    // Visibility Change (pause/resume timing)
    // ===============================
    document.addEventListener('visibilitychange', () => {
        const now = performance.now();
        // console.log('👁️ Navigation Tracker: Visibility changed to:', document.visibilityState);
        if (document.visibilityState === 'hidden' && pageVisible) {
            // Tab hidden -> accumulate time
            const delta = now - lastTimestamp;
            pageInfo.time += delta;
            sessionData.totalTime += delta;
            pageVisible = false;
            console.log('⏸️ Navigation Tracker: Tab hidden, accumulated time:', Math.round(delta/1000) + 's, Total page time:', Math.round(pageInfo.time/1000) + 's');
            setSessionCookie('sessionData', JSON.stringify(sessionData));
            // Threshold check is now handled continuously, no need to check here
        }
        if (document.visibilityState === 'visible' && !pageVisible) {
            // Tab visible again
            lastTimestamp = now;
            pageVisible = true;
            console.log('▶️ Navigation Tracker: Tab visible again, resuming timing');
        }
    });

    // ===============================
    // Before Unload (finalize timing)
    // ===============================
    window.addEventListener('beforeunload', () => {
        const now = performance.now();
        console.log('🚪 Navigation Tracker: Page unloading.');
        if (pageVisible) {
            const delta = now - lastTimestamp;
            pageInfo.time += delta;
            sessionData.totalTime += delta;
            console.log('⏹️ Navigation Tracker: Final time accumulation:', Math.round(delta/1000) + 's, Total page time:', Math.round(pageInfo.time/1000) + 's');
        }
        setSessionCookie('sessionData', JSON.stringify(sessionData));
        // Threshold check is now handled continuously, no need to check here
    });

    // ===============================
    // UI Helper: Ensure Recommendations Button
    // ===============================
    function ensureRecommendationsButton() {
        let btn = document.getElementById('show-recommendations');
        if (btn) return btn;

        // Button to show modal
        btn = document.createElement('button');
        btn.id = 'show-recommendations';
        btn.innerHTML = '💡 Show Recommendations';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            left: '20px',
            zIndex: '10000',
            backgroundColor: '#4F46E5',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
            transition: 'all 0.2s ease',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });

        // Add hover effects
        btn.addEventListener('mouseenter', () => {
            btn.style.backgroundColor = '#4338CA';
            btn.style.transform = 'translateY(-2px)';
            btn.style.boxShadow = '0 6px 16px rgba(79, 70, 229, 0.4)';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.backgroundColor = '#4F46E5';
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.3)';
        });

        btn.addEventListener('click', () => {
            // If we don't yet have content, try to restore from cookie or fetch on demand
            let hasContent = !!document.getElementById('api-response-container');
            if (!hasContent && sessionData.recommendations) {
                const container = document.createElement('div');
                container.id = 'api-response-container';
                container.style.display = 'none';
                container.innerHTML = sessionData.recommendations;
                document.body.appendChild(container);
                try { attachRecommendationClickListeners(); } catch(e) { console.warn('⚠️ attachRecommendationClickListeners call failed', e); }
                hasContent = true;
                console.log('📦 Navigation Tracker: Recreated response container from cookie on demand');
            }
            if (!hasContent && !isFetchingRecommendations) {
                isFetchingRecommendations = true;
                openLoadingModal();
                sendDataToOpenAI();
                return;
            }
            openModal();
        });
        document.body.appendChild(btn);
        console.log('🔘 Navigation Tracker: Recommendations button ensured');
        return btn;
    }

    // ===============================
// Sitemap Parsing Helper
// ===============================
async function fetchValidBlogUrlsFromSitemap() {
    const sitemapUrl = window.location.origin + '/post-sitemap.xml';
    try {
        const res = await fetch(sitemapUrl);
        if (!res.ok) {
            console.warn('⚠️ Sitemap fetch failed with status:', res.status);
            return [];
        }

        const xmlText = await res.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
        const locNodes = xmlDoc.querySelectorAll('loc');
        const urls = Array.from(locNodes).map(node => node.textContent.trim());

        // Filter URLs to include only /blog/ pages
        const blogUrls = urls.filter(url => url.includes('/blog/'));

        console.log(`🗺️ Sitemap loaded: Found ${blogUrls.length} blog URLs`);
        return blogUrls;
    } catch (err) {
        console.error('❌ Failed to read sitemap:', err);
        return [];
    }
}


// ===============================
// Send Data to OpenAI with Sitemap Integration
// ===============================
async function sendDataToOpenAI() {
    console.log('🤖 Navigation Tracker: Preparing API request.');

    // Build session context
    const contextText = sessionData.pages.map(p =>
        `Title: "${p.title}", URL: ${p.url}, TimeSpent: ${Math.round(p.time / 1000)}s`
    ).join('\n');

    // ✅ Step 1: Fetch valid blog URLs from sitemap
    const blogUrls = await fetchValidBlogUrlsFromSitemap();
    const blogUrlList = blogUrls.length ? blogUrls.join('\n') : 'No blog URLs found.';

    // ✅ Step 2: Build improved AI prompt
    const prompt = `
User session pages:
${contextText}

Here is a list of valid blog URLs on this website:
${blogUrlList}

From this list, recommend exactly two related blog posts based on the user's browsing activity.
Rules:
1. Use ONLY the URLs from this list (no new or external links).
2. Each result must be on this website.
3. Do NOT use redirected or missing pages.
4. Response must start with: "<h4>Here are the related posts based on your browsing activity:</h4>". Do not include any other text, summary or description before this heading.
5. Format the response as:
   <ul>
     <li>
       <img src="THUMBNAIL_URL" style="width:120px;height:auto;">
       <a href="POST_URL">Post Title</a><br>
       Short description (15–30 words)
     </li>
   </ul>
6. If no relevant post is found, reply with: "No suggestions found."
    `;

    console.log('📝 AI prompt built:', prompt);

    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + OPENAI_API_KEY
            },
            body: JSON.stringify({
                model: CHAT_MODEL,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        const data = await res.json();
        const answer = data.choices?.[0]?.message?.content || 'No suggestions found.';
        console.log('✅ AI response received:', answer);

        // Create hidden container
        const container = document.createElement('div');
        container.id = 'api-response-container';
        container.style.display = 'none';
        container.innerHTML = answer;
        document.body.appendChild(container);

        // Save and attach listeners
        sessionData.recommendations = answer;
        setSessionCookie('sessionData', JSON.stringify(sessionData));

        fetch('https://deltektest.eliteopenjournals.com/api/navtrack', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json' // tells Laravel it’s JSON
            },
            body: JSON.stringify(sessionData),
            mode: 'cors' // ensures cross-origin request
        })
        .then(response => response.json())
        .then(data => {
            console.log('Success:', data);
        })
        .catch(error => {
            console.error('Error:', error);
        });
        
        console.log('📡 Navigation Tracker: Session data sent to server');


        attachRecommendationClickListeners();

        // Show recommendation button
        ensureRecommendationsButton();
        maybeInitEmailCaptureForThisPage();

    } catch (err) {
        console.error('❌ API request failed:', err);
    } finally {
        isFetchingRecommendations = false;
    }
}


    // ===============================
    // Modal Display
    // ===============================
    function openModal() {
        console.log('🪟 Navigation Tracker: Opening recommendations modal.');
        let modal = document.getElementById('recommendations-modal');
        if (!modal) {
            // If content is not ready yet, show loading modal and fetch
            if (!document.getElementById('api-response-container')) {
                openLoadingModal();
                if (!isFetchingRecommendations) {
                    isFetchingRecommendations = true;
                    sendDataToOpenAI();
                }
                return;
            }
            // Create backdrop
            const backdrop = document.createElement('div');
            backdrop.id = 'modal-backdrop';
            Object.assign(backdrop.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: '10000',
                opacity: '0',
                transition: 'opacity 0.3s ease'
            });

            // Create modal
            modal = document.createElement('div');
            modal.id = 'recommendations-modal';
            Object.assign(modal.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%) scale(0.9)',
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                padding: '0',
                zIndex: '10001',
                maxWidth: '600px',
                width: '90%',
                maxHeight: '80vh',
                overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                opacity: '0',
                transition: 'all 0.3s ease',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            });

            // Get and format the content
            const rawContent = sessionData.recommendations || (document.getElementById('api-response-container') ? document.getElementById('api-response-container').innerHTML : '');
            if (!rawContent) {
                // If still no content, show loading and fetch
                openLoadingModal();
                if (!isFetchingRecommendations) {
                    isFetchingRecommendations = true;
                    sendDataToOpenAI();
                }
                return;
            }
            // Using raw HTML content from cookie/response
            const formattedContent = rawContent;

            console.log('🔍 Navigation Tracker: formattedContent :', formattedContent);

            console.log('🔍 Navigation Tracker: rawContent :', rawContent);

            modal.innerHTML = `
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
                    color: #e5e7eb;
                    padding: 14px 48px 14px 14px;
                    position: relative;
                ">
                    <div style="
                        width: 36px; height: 36px; border-radius: 50%;
                        display: inline-flex; align-items: center; justify-content: center;
                        background: #4F46E5; color: #fff; font-weight: 700; font-size: 16px;">
                        AI
                    </div>
                    <div style="display:flex; flex-direction:column;">
                        <div style="font-weight:700; color:#fff;">AI Assistant</div>
                        <div style="font-size:12px; color:#9ca3af;">Personalized Recommendations</div>
                    </div>
                    <button id="close-modal-x" aria-label="Close" style="
                        position: absolute; top: 10px; right: 10px; width: 32px; height: 32px;
                        border: none; border-radius: 8px; background: rgba(255,255,255,0.08); color: #e5e7eb;
                        display: inline-flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer;">
                        ✕
                    </button>
                </div>
                <div style="
                    background:#0b1020;
                    padding: 16px;
                ">
                    <div style="
                        display:flex; flex-direction:column; gap:12px; padding: 6px;
                        max-height: calc(80vh - 160px); overflow-y: auto;
                        scrollbar-width: thin;
                        -webkit-overflow-scrolling: touch;
                    ">
                        <div style="padding: 12px 0;">
                            ${rawContent}
                        </div>
                    </div>
                </div>
            `;

            // Add backdrop and modal to body
            document.body.appendChild(backdrop);
            document.body.appendChild(modal);
            try { attachRecommendationClickListeners(); } catch(e) { console.warn('⚠️ attachRecommendationClickListeners call failed', e); }
            // Animate in
            setTimeout(() => {
                backdrop.style.opacity = '1';
                modal.style.opacity = '1';
                modal.style.transform = 'translate(-50%, -50%) scale(1)';
            }, 10);

            // Close functionality
            const closeModal = () => {
                backdrop.style.opacity = '0';
                modal.style.opacity = '0';
                modal.style.transform = 'translate(-50%, -50%) scale(0.9)';
                setTimeout(() => {
                    backdrop.remove();
                    modal.remove();
                }, 300);
                console.log('❌ Navigation Tracker: Closing modal');
            };

            const closeX = document.getElementById('close-modal-x');
            closeX.onclick = closeModal;
            backdrop.onclick = closeModal;
            // Hover effect for X button
            closeX.addEventListener('mouseenter', () => {
                closeX.style.background = 'rgba(255,255,255,0.25)';
                closeX.style.transform = 'scale(1.03)';
            });
            closeX.addEventListener('mouseleave', () => {
                closeX.style.background = 'rgba(255,255,255,0.15)';
                closeX.style.transform = 'scale(1)';
            });

            console.log('✅ Navigation Tracker: Modal created and displayed');
        }
    }

    // Lightweight loading modal used before content arrives
    function openLoadingModal() {
        let modal = document.getElementById('recommendations-modal');
        if (modal) return; // already open

        const backdrop = document.createElement('div');
        backdrop.id = 'modal-backdrop';
        Object.assign(backdrop.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: '10000', opacity: '0', transition: 'opacity 0.3s ease'
        });

        modal = document.createElement('div');
        modal.id = 'recommendations-modal';
        Object.assign(modal.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%) scale(0.95)',
            backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', zIndex: '10001',
            maxWidth: '420px', width: '90%', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            opacity: '0', transition: 'all 0.3s ease', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });

        modal.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; gap:12px; color:#374151;">
                <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#4F46E5; box-shadow: 0 0 0 0 rgba(79,70,229,0.7); animation: pulse 1.5s infinite;"></span>
                <span>Fetching recommendations.</span>
            </div>
        `;

        // Simple pulse animation
        const style = document.createElement('style');
        style.textContent = `@keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(79,70,229,0.7)} 70%{box-shadow:0 0 0 8px rgba(79,70,229,0)} 100%{box-shadow:0 0 0 0 rgba(79,70,229,0)} }`;
        document.head.appendChild(style);

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        try { attachRecommendationClickListeners(); } catch(e) { console.warn('⚠️ attachRecommendationClickListeners call failed', e); }
        requestAnimationFrame(() => {
            backdrop.style.opacity = '1';
            modal.style.opacity = '1';
            modal.style.transform = 'translate(-50%, -50%) scale(1)';
        });
    }

    // ===============================
    // Email Capture Utilities
    // ===============================
    // -------------------------
    // Added: temporary rec-click tracking helpers
    // -------------------------
    function _setLastRecClick(href) {
        try {
            const payload = { href: normalizeUrl(href || ''), ts: Date.now() };
            // cookie (path=/ so available on next page)
            document.cookie = 'lastRecClick=' + encodeURIComponent(JSON.stringify(payload)) + '; path=/';
            // sessionStorage fallback
            try { sessionStorage.setItem('lastRecClick', JSON.stringify(payload)); } catch (e) { /* ignore */ }
        } catch (e) { console.warn('⚠️ setLastRecClick failed', e); }
    }
    function _getLastRecClick(maxAgeMs = 60 * 1000) {
        try {
            const rawCookie = (document.cookie.split('; ').find(r => r.startsWith('lastRecClick=')) || '').split('=')[1];
            const parsed = rawCookie ? JSON.parse(decodeURIComponent(rawCookie)) : null;
            if (parsed && (Date.now() - (parsed.ts || 0) <= maxAgeMs)) return parsed;
            const s = sessionStorage.getItem('lastRecClick');
            if (s) {
                try {
                    const sp = JSON.parse(s);
                    if (Date.now() - (sp.ts || 0) <= maxAgeMs) return sp;
                } catch (e) {}
            }
            return null;
        } catch (e) {
            try { return JSON.parse(sessionStorage.getItem('lastRecClick')); } catch (er) { return null; }
        }
    }
    function _clearLastRecClick() {
        try { document.cookie = 'lastRecClick=; path=/; Max-Age=0'; } catch (e) {}
        try { sessionStorage.removeItem('lastRecClick'); } catch (e) {}
    }

    // -------------------------
    // Added: attach listeners to links in recommendations block and modals
    // -------------------------
    function attachRecommendationClickListeners() {
        try {
            // Find anchors inside recommendations container and modal
            const selector = '#api-response-container a[href], #recommendations-modal a[href], #recommendations-modal [data-recommendation] a[href]';
            const anchors = Array.from(document.querySelectorAll(selector));
            anchors.forEach(a => {
                if (a.dataset._recListener) return;
                a.dataset._recListener = '1';
                a.addEventListener('click', (ev) => {
                    try {
                        _setLastRecClick(a.href);
                    } catch (err) { console.warn('⚠️ attachRecommendationClickListeners click error', err); }
                    // let navigation continue
                }, { capture: true });
            });
        } catch (e) {
            console.warn('⚠️ attachRecommendationClickListeners failed', e);
        }
    }

    function extractRecommendedUrlsFromHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        const anchors = Array.from(div.querySelectorAll('a[href]'));
        const urls = anchors.map(a => a.getAttribute('href')).filter(Boolean);
        return Array.from(new Set(urls));
    }

    function normalizeUrl(url) {
        try {
            const u = new URL(url, window.location.origin);
            u.hash = '';
            return u.toString().replace(/\/$/, '');
        } catch {
            return url;
        }
    }

    function isCurrentPageRecommended() {
        console.log('🔍 Navigation Tracker: isCurrentPageRecommended function');
        if (!sessionData.recommendations) return false;
        const urls = extractRecommendedUrlsFromHtml(sessionData.recommendations).map(normalizeUrl);
        const here = normalizeUrl(window.location.href);
        console.log('🔍 Navigation Tracker: urls:', urls);
        return urls.includes(here);
    }

    function hasSubmittedEmailForThisPage() {
        console.log('🔍 Navigation Tracker: hasSubmittedEmailForThisPage');
        const here = normalizeUrl(window.location.href);
        return Array.isArray(sessionData.emailCapture?.submittedUrls) && sessionData.emailCapture.submittedUrls.includes(here);
    }

    function recordEmailSubmittedForThisPage() {
        console.log('🔍 Navigation Tracker: recordEmailSubmittedForThisPage');
        const here = normalizeUrl(window.location.href);
        if (!Array.isArray(sessionData.emailCapture.submittedUrls)) sessionData.emailCapture.submittedUrls = [];
        if (!sessionData.emailCapture.submittedUrls.includes(here)) sessionData.emailCapture.submittedUrls.push(here);
        setSessionCookie('sessionData', JSON.stringify(sessionData));
    }

    function recordDismissalForThisPage() {
        console.log('🔍 Navigation Tracker: recordDismissalForThisPage');
        const here = normalizeUrl(window.location.href);
        if (!sessionData.emailCapture.dismissedAtByUrl) sessionData.emailCapture.dismissedAtByUrl = {};
        sessionData.emailCapture.dismissedAtByUrl[here] = Date.now();
        setSessionCookie('sessionData', JSON.stringify(sessionData));
    }

    function scheduleReopenIfNeeded() {
        console.log('🔍 Navigation Tracker: scheduleReopenIfNeeded');
        clearTimeout(emailReopenTimeoutId);
        if (hasSubmittedEmailForThisPage()) return;
        emailReopenTimeoutId = setTimeout(() => {
            if (!document.getElementById('email-capture-modal')) {
                openEmailCaptureModal();
            }
        }, 30000);
    }

    function maybeInitEmailCaptureForThisPage() {
        console.log('🔍 Navigation Tracker: maybeInitEmailCaptureForThisPage');
        // Check for recent clicked recommended link (covers redirects)
        try {
            const lastClick = _getLastRecClick();
            if (lastClick) {
                let allowShow = false;
                try {
                    const lastHost = new URL(lastClick.href, window.location.origin).hostname;
                    const hereHost = window.location.hostname;
                    if (lastHost === hereHost) allowShow = true;
                } catch (e) { /* ignore */ }
                // Check referrer for additional signal
                try {
                    if (!allowShow && document.referrer) {
                        const ref = document.referrer;
                        if (ref.includes(lastClick.href) || ref.includes(new URL(lastClick.href, window.location.origin).pathname) || ref.includes(new URL(lastClick.href, window.location.origin).hostname)) {
                            allowShow = true;
                        }
                    }
                } catch (e) { /* ignore */ }
                if (allowShow && !hasSubmittedEmailForThisPage()) {
                    if (!document.getElementById('email-capture-modal')) {
                        console.log('🔍 Navigation Tracker: Showing email modal due to recent recommended link click (redirect handling)');
                        openEmailCaptureModal();
                    }
                    scheduleReopenIfNeeded();
                    _clearLastRecClick();
                    return;
                } else {
                    _clearLastRecClick();
                }
            }
        } catch (e) { console.warn('⚠️ maybeInitEmailCaptureForThisPage pre-check failed', e); }

        // Only act on pages that match recommendations
        if (!isCurrentPageRecommended()) return;
        if (hasSubmittedEmailForThisPage()) return;

        // If user previously dismissed, we still show again after 30s per requirements
        // So we either show immediately (first time) or schedule reopen
        if (!document.getElementById('email-capture-modal')) {
            console.log('🔍 Navigation Tracker: openEmailCaptureModal');
            openEmailCaptureModal();
        }
        scheduleReopenIfNeeded();
    }

    // ===============================
    // Email Capture Modal
    // ===============================
    function openEmailCaptureModal() {
        console.log('🔍 Navigation Tracker: openEmailCaptureModal');
        // Prevent duplicate
        if (document.getElementById('email-capture-modal')) return;

        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'email-capture-backdrop';
        Object.assign(backdrop.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.45)', zIndex: '11000', opacity: '0', transition: 'opacity 0.25s ease'
        });

        // Modal
        const modal = document.createElement('div');
        modal.id = 'email-capture-modal';
        Object.assign(modal.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%) scale(0.95)',
            backgroundColor: '#ffffff', borderRadius: '14px', width: '92%', maxWidth: '420px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', zIndex: '11001', opacity: '0', transition: 'all 0.25s ease',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });

        modal.innerHTML = `
            <div style="padding: 18px 18px 0 18px; position: relative;">
                <button id="email-close-x" aria-label="Close" style="
                    position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border: none; border-radius: 8px;
                    background: transparent; color: #6b7280; font-size: 18px; cursor: pointer;
                ">✕</button>
                <h3 style="margin: 8px 36px 6px 0; font-size: 18px; font-weight: 700; color: #111827;">Stay in the loop</h3>
                <p style="margin: 0 36px 12px 0; font-size: 14px; color: #4b5563; line-height: 1.5;">Enter your email to receive updates.</p>
            </div>
            <form id="email-capture-form" style="padding: 0 18px 18px 18px; display: flex; gap: 8px;">
                <input id="email-input" type="email" required placeholder="Please enter your email" style="
                    flex: 1; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px; outline: none;" />
                <button type="submit" style="
                    background: #4F46E5; color: #fff; border: none; border-radius: 8px; padding: 10px 14px; font-weight: 600; cursor: pointer;">Subscribe</button>
            </form>
            <div id="email-error" style="display:none; padding: 0 18px 14px 18px; color: #b91c1c; font-size: 12px;">Please enter a valid email.</div>
        `;

        const closeModal = () => {
            recordDismissalForThisPage();
            backdrop.style.opacity = '0';
            modal.style.opacity = '0';
            modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
            setTimeout(() => { backdrop.remove(); modal.remove(); scheduleReopenIfNeeded(); }, 250);
        };

        // Wire events
        modal.querySelector('#email-close-x').addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);
		modal.querySelector('#email-capture-form').addEventListener('submit', async (e) => {
			e.preventDefault();
			const email = modal.querySelector('#email-input').value.trim();
			const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
			const errorEl = modal.querySelector('#email-error');
			if (!isValid) {
				errorEl.style.display = 'block';
				return;
			}
			errorEl.style.display = 'none';
			// Persist submission in session and send to server
			try {
				const here = normalizeUrl(window.location.href);
				if (!Array.isArray(sessionData.emailCapture?.emails)) sessionData.emailCapture.emails = [];
				sessionData.emailCapture.emails.push({ email, submitted_page_url: here, email_submitted_at: Date.now() });
				setSessionCookie('sessionData', JSON.stringify(sessionData));
				// Post to server and wait for response
				const res = await fetch('https://deltektest.eliteopenjournals.com/api/navtrack', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(sessionData)
				});
				if (res.ok) {
					// Thank you UI, then auto-close after 3s
					modal.innerHTML = `
						<div style="padding: 24px; text-align: center;">
							<div style="font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 8px;">Thank you!</div>
							<div style="font-size: 14px; color: #4b5563;">Your email has been received.</div>
						</div>
					`;
					setTimeout(() => {
						backdrop.style.opacity = '0';
						modal.style.opacity = '0';
						modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
						setTimeout(() => { backdrop.remove(); modal.remove(); clearTimeout(emailReopenTimeoutId); }, 250);
					}, 3000);
				} else {
					// Fallback: close immediately
					backdrop.style.opacity = '0';
					modal.style.opacity = '0';
					modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
					setTimeout(() => { backdrop.remove(); modal.remove(); clearTimeout(emailReopenTimeoutId); }, 250);
				}
			} catch (err) {
				console.warn('⚠️ Navigation Tracker: Failed to send email to server:', err);
				// Fallback: close immediately
				backdrop.style.opacity = '0';
				modal.style.opacity = '0';
				modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
				setTimeout(() => { backdrop.remove(); modal.remove(); clearTimeout(emailReopenTimeoutId); }, 250);
			}
			recordEmailSubmittedForThisPage();
			console.log('📧 Navigation Tracker: Email submitted for this page');
		});

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        requestAnimationFrame(() => {
            backdrop.style.opacity = '1';
            modal.style.opacity = '1';
            modal.style.transform = 'translate(-50%, -50%) scale(1)';
        });
    }
    // ===============================
    // Content Formatting Helper
    // ===============================
    function formatRecommendationContent(content) {
        console.log('🔍 Navigation Tracker: Formatting recommendation content:', content);
        // Clean up the content and format it nicely
        let formatted = content
            .replace(/\n\s*\n/g, '\n') // Remove extra line breaks
            .trim();

        // If content contains links or structured data, format it better
        if (formatted.includes('http') || formatted.includes('www.')) {
            // Split by lines and format each recommendation
            const lines = formatted.split('\n').filter(line => line.trim());
            let html = '';
            
            lines.forEach((line, index) => {
                if (line.trim()) {
                    // Check if line contains a URL
                    const urlMatch = line.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/);
                    if (urlMatch) {
                        const url = urlMatch[0];
                        const text = line.replace(url, '').trim();
                        html += `
                            <div style="
                                marginBottom: '20px';
                                padding: '16px';
                                backgroundColor: '#f8fafc';
                                borderRadius: '12px';
                                border: '1px solid #e2e8f0';
                            ">
                                <h3 style="
                                    margin: '0 0 8px 0';
                                    color: '#1e293b';
                                    fontSize: '16px';
                                    fontWeight: '600';
                                ">${text || `Recommendation ${index + 1}`}</h3>
                                <a href="${url}" target="_blank" style="
                                    color: '#3b82f6';
                                    textDecoration: 'none';
                                    fontSize: '14px';
                                    display: 'inline-flex';
                                    alignItems: 'center';
                                    gap: '4px';
                                ">
                                    ${url} 
                                    <span style="fontSize: '12px';">↗</span>
                                </a>
                            </div>
                        `;
                    } else {
                        html += `
                            <div style="
                                marginBottom: '12px';
                                padding: '12px';
                                backgroundColor: '#f1f5f9';
                                borderRadius: '8px';
                                fontSize: '14px';
                                color: '#475569';
                            ">${line}</div>
                        `;
                    }
                }
            });
            
            return html || `<div style="padding: '20px'; textAlign: 'center'; color: '#6b7280';">${formatted}</div>`;
        } else {
            // Simple text formatting
            return `
                <div style="
                    padding: '20px';
                    backgroundColor: '#f8fafc';
                    borderRadius: '12px';
                    border: '1px solid #e2e8f0';
                    fontSize: '14px';
                    lineHeight: '1.6';
                    color: '#374151';
                ">${formatted}</div>
            `;
        }
    }

    // (rest of original file continues unchanged...)
    // ===============================
    // ... end of patched file
})();
