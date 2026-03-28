const DEFAULT_API_URL = "http://localhost:4000/graphql";
export function getApiUrl() {
    return process.env.ISSUES_API_URL ?? DEFAULT_API_URL;
}
export function getAuthToken() {
    return process.env.ISSUES_AUTH_TOKEN;
}
export function getDefaultProjectId() {
    return process.env.ISSUES_PROJECT_ID;
}
export function getDefaultProjectName() {
    return process.env.ISSUES_PROJECT_NAME;
}
//# sourceMappingURL=config.js.map