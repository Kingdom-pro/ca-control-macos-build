#include "policy.h"
#include <string.h>

static bool ascii_equal(const char *left, const char *right, size_t length) {
    for (size_t i = 0; i < length; ++i) {
        unsigned char a = (unsigned char)left[i];
        unsigned char b = (unsigned char)right[i];
        if (a >= 'A' && a <= 'Z') a += 'a' - 'A';
        if (b >= 'A' && b <= 'Z') b += 'a' - 'A';
        if (a != b) return false;
    }
    return true;
}

static bool app_family(const char *id) {
    if (!id) return false;
    const char team[] = "Q6L2SF6YDW.";
    size_t length = strlen(id);
    if (length >= sizeof(team) - 1 && ascii_equal(id, team, sizeof(team) - 1)) {
        id += sizeof(team) - 1;
        length -= sizeof(team) - 1;
    }
    const char *roots[] = { "com.anthropic.claudefordesktop", "com.anthropic.claude-code" };
    for (size_t i = 0; i < sizeof(roots) / sizeof(roots[0]); ++i) {
        const size_t root_length = strlen(roots[i]);
        if (length >= root_length && ascii_equal(id, roots[i], root_length) &&
            (length == root_length || id[root_length] == '.')) return true;
    }
    return false;
}

static bool claude_domain(const char *host) {
    if (!host) return false;
    size_t length = strlen(host);
    if (length && host[length - 1] == '.') --length;
    const char *roots[] = {
        "anthropic.com", "claude.ai", "claude.com", "www.claudeusercontent.com", "claudemcpcontent.com"
    };
    for (size_t i = 0; i < sizeof(roots) / sizeof(roots[0]); ++i) {
        const size_t root_length = strlen(roots[i]);
        if (length < root_length) continue;
        const size_t start = length - root_length;
        if ((!start || host[start - 1] == '.') && ascii_equal(host + start, roots[i], root_length)) return true;
    }
    return false;
}

bool ca_filter_blocks(const char *app_id, const char *process_id, const char *hostname) {
    return app_family(app_id) || app_family(process_id) || claude_domain(hostname);
}
