declare module "googleapis" {
  export const google: {
    auth: {
      OAuth2: new (
        clientId: string,
        clientSecret: string,
        redirectUri: string,
      ) => {
        setCredentials(creds: { refresh_token: string }): void;
        getAccessToken(): Promise<any>;
      };
    };
    gmail(options: { version: string; auth: any }): any;
    calendar(options: { version: string; auth: any }): any;
    drive(options: { version: string; auth: any }): any;
  };
}
