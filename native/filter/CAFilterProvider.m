#import <Foundation/Foundation.h>
#import <NetworkExtension/NetworkExtension.h>
#import <Security/Security.h>
#import "policy.h"

static NSString *signingIdentifier(NSData *token) {
    if (token.length == 0) return nil;
    NSDictionary *attributes = @{ (__bridge NSString *)kSecGuestAttributeAudit: token };
    SecCodeRef guest = NULL;
    if (SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &guest) != errSecSuccess) return nil;

    SecStaticCodeRef code = NULL;
    OSStatus status = SecCodeCopyStaticCode(guest, kSecCSDefaultFlags, &code);
    CFRelease(guest);
    if (status != errSecSuccess) return nil;

    CFDictionaryRef information = NULL;
    status = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information);
    CFRelease(code);
    if (status != errSecSuccess) return nil;
    NSDictionary *details = CFBridgingRelease(information);
    return details[(__bridge NSString *)kSecCodeInfoIdentifier];
}

@interface CAFilterProvider : NEFilterDataProvider
@end

@implementation CAFilterProvider

- (void)startFilterWithCompletionHandler:(void (^)(NSError *))completionHandler {
    [self applySettings:nil completionHandler:completionHandler];
}

- (void)stopFilterWithReason:(NEProviderStopReason)reason completionHandler:(void (^)(void))completionHandler {
    (void)reason;
    completionHandler();
}

- (NEFilterNewFlowVerdict *)handleNewFlow:(NEFilterFlow *)flow {
    NSString *host = flow.URL.host;
    if (ca_filter_blocks(flow.sourceAppIdentifier.UTF8String, NULL, host.UTF8String)) {
        return [NEFilterNewFlowVerdict dropVerdict];
    }
    if ([flow isKindOfClass:NEFilterSocketFlow.class]) {
        NEFilterSocketFlow *socketFlow = (NEFilterSocketFlow *)flow;
        if (ca_filter_blocks(NULL, NULL, socketFlow.remoteHostname.UTF8String)) {
            return [NEFilterNewFlowVerdict dropVerdict];
        }
    }

    NSString *application = signingIdentifier(flow.sourceAppAuditToken);
    if (ca_filter_blocks(application.UTF8String, NULL, NULL)) return [NEFilterNewFlowVerdict dropVerdict];
    if (@available(macOS 13.0, *)) {
        NSData *processToken = flow.sourceProcessAuditToken;
        NSString *process = [processToken isEqual:flow.sourceAppAuditToken] ? nil : signingIdentifier(processToken);
        if (ca_filter_blocks(NULL, process.UTF8String, NULL)) return [NEFilterNewFlowVerdict dropVerdict];
    }

    return [NEFilterNewFlowVerdict allowVerdict];
}

@end

int main(void) {
    @autoreleasepool {
        [NEProvider startSystemExtensionMode];
        dispatch_main();
    }
}
