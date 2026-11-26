#include "../native/filter/policy.h"
#include <stdio.h>

int main(void) {
    const struct {
        const char *app;
        const char *process;
        const char *host;
        bool blocked;
    } cases[] = {
        { "com.anthropic.claudefordesktop", NULL, "198.51.100.4", true },
        { "Q6L2SF6YDW.com.anthropic.claudefordesktop.helper.Renderer", NULL, NULL, true },
        { NULL, "com.anthropic.claude-code", "203.0.113.1", true },
        { NULL, "com.anthropic.claudefordesktop.helper", "2001:db8::3", true },
        { "com.apple.Safari", NULL, "API.Anthropic.COM.", true },
        { "com.google.Chrome", NULL, "claude.ai", true },
        { "org.mozilla.firefox", NULL, "f.claude.com", true },
        { NULL, NULL, "www.claudeusercontent.com", true },
        { NULL, NULL, "cdn.claudemcpcontent.com", true },
        { "com.apple.Safari", NULL, "persistent.oaistatic.com", false },
        { "com.google.Chrome", "com.google.Chrome.helper", "example.org", false },
        { "com.anthropic.claudefordesktopfake", NULL, "anthropic.com.example.org", false },
        { "org.example.claude-code", NULL, "notclaude.ai", false },
        { NULL, NULL, "192.0.2.1", false },
        { NULL, NULL, NULL, false },
        { "", "", ".", false },
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
        if (ca_filter_blocks(cases[i].app, cases[i].process, cases[i].host) != cases[i].blocked) {
            fprintf(stderr, "Unexpected verdict for case %zu\n", i + 1);
            return 1;
        }
    }
    printf("PASS %zu filter verdicts\n", sizeof(cases) / sizeof(cases[0]));
    return 0;
}
