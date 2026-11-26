#ifndef CA_CONTROL_FILTER_POLICY_H
#define CA_CONTROL_FILTER_POLICY_H

#include <stdbool.h>

bool ca_filter_blocks(const char *app_id, const char *process_id, const char *hostname);

#endif
