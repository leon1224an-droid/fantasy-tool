/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string | object = string> {
      hrefInputParams: { pathname: Router.RelativePathString, params?: Router.UnknownInputParams } | { pathname: Router.ExternalPathString, params?: Router.UnknownInputParams } | { pathname: `/_sitemap`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}` | `/`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}/lineup` | `/lineup`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}/projections` | `/projections`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}/schedule` | `/schedule`; params?: Router.UnknownInputParams; };
      hrefOutputParams: { pathname: Router.RelativePathString, params?: Router.UnknownOutputParams } | { pathname: Router.ExternalPathString, params?: Router.UnknownOutputParams } | { pathname: `/_sitemap`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(tabs)'}` | `/`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(tabs)'}/lineup` | `/lineup`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(tabs)'}/projections` | `/projections`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(tabs)'}/schedule` | `/schedule`; params?: Router.UnknownOutputParams; };
      href: Router.RelativePathString | Router.ExternalPathString | `/_sitemap${`?${string}` | `#${string}` | ''}` | `${'/(tabs)'}${`?${string}` | `#${string}` | ''}` | `/${`?${string}` | `#${string}` | ''}` | `${'/(tabs)'}/lineup${`?${string}` | `#${string}` | ''}` | `/lineup${`?${string}` | `#${string}` | ''}` | `${'/(tabs)'}/projections${`?${string}` | `#${string}` | ''}` | `/projections${`?${string}` | `#${string}` | ''}` | `${'/(tabs)'}/schedule${`?${string}` | `#${string}` | ''}` | `/schedule${`?${string}` | `#${string}` | ''}` | { pathname: Router.RelativePathString, params?: Router.UnknownInputParams } | { pathname: Router.ExternalPathString, params?: Router.UnknownInputParams } | { pathname: `/_sitemap`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}` | `/`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}/lineup` | `/lineup`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}/projections` | `/projections`; params?: Router.UnknownInputParams; } | { pathname: `${'/(tabs)'}/schedule` | `/schedule`; params?: Router.UnknownInputParams; };
    }
  }
}
