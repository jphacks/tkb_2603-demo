import type { Settings } from './settings';

export const CONSENT_VERSION = 1;
export const PRIVACY_COPY = '会話の分類のため、会話1往復の本文と直前の作業名をAnthropicへ送信します。「キーなしで使う」では中継サーバーを経由します。中継サーバーは本文を保存・ログ出力しません。AnthropicのAPIでは原則として学習に使われず、入力・出力は30日以内に削除されます（法令対応などの例外があります）。同意は設定からいつでも取り消せます。';
export const PRIVACY_POLICY_URL = 'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data';

export function hasClassificationConsent(settings: Settings): boolean {
  return settings.classificationConsent === 'accepted' && settings.classificationConsentVersion === CONSENT_VERSION;
}

export function canClassify(settings: Settings): boolean {
  return settings.enabled && settings.llmEnabled && hasClassificationConsent(settings)
    && (settings.classifierMode === 'proxy' || !!settings.apiKey);
}

export function needsConsent(settings: Settings): boolean {
  return settings.llmEnabled && !hasClassificationConsent(settings) && settings.classificationConsent !== 'declined';
}
