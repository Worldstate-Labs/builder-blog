"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultUiLocale,
  localeHtmlLang,
  translate,
  uiLocaleCookieName,
  uiLocaleStorageKey,
  type I18nKey,
  type UiLocale,
} from "@/lib/i18n";
import { translateUiPhrase } from "@/lib/i18n-phrases";

type I18nContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (key: I18nKey, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function persistLocale(locale: UiLocale) {
  const htmlLang = localeHtmlLang(locale);
  document.documentElement.lang = htmlLang;
  document.documentElement.dataset.locale = locale;
  try {
    localStorage.setItem(uiLocaleStorageKey, locale);
  } catch {
    // Locale persistence is a progressive enhancement.
  }
  document.cookie = `${uiLocaleCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function I18nProvider({
  children,
  initialLocale: serverLocale = defaultUiLocale,
}: {
  children: ReactNode;
  initialLocale?: UiLocale;
}) {
  const [locale, setLocaleState] = useState<UiLocale>(serverLocale);

  const setLocale = useCallback((nextLocale: UiLocale) => {
    setLocaleState(nextLocale);
    persistLocale(nextLocale);
  }, []);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return (
    <I18nContext.Provider value={value}>
      <I18nDomTranslator />
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  return value ?? fallbackI18n;
}

export function I18nText({
  id,
  values,
}: {
  id: I18nKey;
  values?: Record<string, string | number>;
}) {
  const { t } = useI18n();
  return <>{t(id, values)}</>;
}

const translatedAttrs = ["aria-label", "title", "placeholder", "alt"] as const;
const skippedTextTags = new Set([
  "CODE",
  "INPUT",
  "KBD",
  "NOSCRIPT",
  "OPTION",
  "PRE",
  "SAMP",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "TEXTAREA",
]);
const skippedContentSelector = [
  "[contenteditable='true']",
  "[data-i18n-skip]",
  ".digest-prose",
  ".markdown-editor-textarea",
  ".markdown-preview",
  ".post-detail-body",
  ".source-content",
].join(",");

const originalTextByNode = new WeakMap<Text, string>();
const translatedTextByNode = new WeakMap<Text, string>();
const originalAttrsByElement = new WeakMap<Element, Map<string, string>>();
const translatedAttrsByElement = new WeakMap<Element, Map<string, string>>();
const elementNodeType = 1;
const textNodeType = 3;

function I18nDomTranslator() {
  const { locale } = useI18n();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.body;
    if (!root) return;

    let applying = false;
    let frame = 0;
    let timer = 0;

    function isSkippedElement(element: Element) {
      if (skippedTextTags.has(element.tagName)) return true;
      return Boolean(element.closest(skippedContentSelector));
    }

    function rememberText(node: Text) {
      const current = node.nodeValue ?? "";
      const previousTranslation = translatedTextByNode.get(node);
      if (!originalTextByNode.has(node) || (previousTranslation && current !== previousTranslation)) {
        originalTextByNode.set(node, current);
      }
      return originalTextByNode.get(node) ?? current;
    }

    function setTranslatedText(node: Text, original: string, translation: string | null) {
      const leadingWhitespace = original.match(/^\s*/u)?.[0] ?? "";
      const trailingWhitespace = original.match(/\s*$/u)?.[0] ?? "";
      const nextValue = translation
        ? `${leadingWhitespace}${translation}${trailingWhitespace}`
        : original;
      if (node.nodeValue !== nextValue) {
        node.nodeValue = nextValue;
      }
      translatedTextByNode.set(node, nextValue);
    }

    function translateTextNode(node: Text) {
      const parent = node.parentElement;
      if (!parent || isSkippedElement(parent)) return;
      const original = rememberText(node);
      const translation = translateUiPhrase(locale, original);
      setTranslatedText(node, original, translation);
    }

    function rememberAttr(element: Element, attr: string) {
      const current = element.getAttribute(attr);
      if (!current) return null;
      const existingOriginals = originalAttrsByElement.get(element) ?? new Map<string, string>();
      const existingTranslations = translatedAttrsByElement.get(element);
      const previousTranslation = existingTranslations?.get(attr);
      if (!existingOriginals.has(attr) || (previousTranslation && current !== previousTranslation)) {
        existingOriginals.set(attr, current);
        originalAttrsByElement.set(element, existingOriginals);
      }
      return existingOriginals.get(attr) ?? current;
    }

    function setTranslatedAttr(
      element: Element,
      attr: (typeof translatedAttrs)[number],
      original: string,
      translation: string | null,
    ) {
      const nextValue = translation ?? original;
      if (element.getAttribute(attr) !== nextValue) {
        element.setAttribute(attr, nextValue);
      }
      const existingTranslations = translatedAttrsByElement.get(element) ?? new Map<string, string>();
      existingTranslations.set(attr, nextValue);
      translatedAttrsByElement.set(element, existingTranslations);
    }

    function translateElementAttrs(element: Element) {
      if (isSkippedElement(element)) return;
      for (const attr of translatedAttrs) {
        const original = rememberAttr(element, attr);
        if (!original) continue;
        const translation = translateUiPhrase(locale, original);
        setTranslatedAttr(element, attr, original, translation);
      }
    }

    function translateTree(node: Node) {
      if (node.nodeType === textNodeType) {
        translateTextNode(node as Text);
        return;
      }
      if (node.nodeType !== elementNodeType) return;
      const element = node as Element;
      translateElementAttrs(element);
      if (isSkippedElement(element)) return;
      const stack = Array.from(element.childNodes).reverse();
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        if (current.nodeType === textNodeType) {
          translateTextNode(current as Text);
        } else if (current.nodeType === elementNodeType) {
          const currentElement = current as Element;
          translateElementAttrs(currentElement);
          if (isSkippedElement(currentElement)) {
            continue;
          }
          stack.push(...Array.from(currentElement.childNodes).reverse());
        }
      }
    }

    function scheduleTranslate(node: Node = root, delayMs = 0) {
      if (frame) cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        frame = requestAnimationFrame(() => {
          applying = true;
          try {
            translateTree(node);
          } finally {
            applying = false;
          }
        });
      }, delayMs);
    }

    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      let target: Node | null = null;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          target = mutation.target;
          break;
        }
        if (mutation.type === "attributes") {
          target = mutation.target;
          break;
        }
        if (mutation.addedNodes.length > 0) {
          target = mutation.target;
          break;
        }
      }
      if (target) scheduleTranslate(root, 80);
    });

    scheduleTranslate(root);
    observer.observe(root, {
      attributeFilter: [...translatedAttrs],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [locale]);

  return null;
}

const fallbackI18n: I18nContextValue = {
  locale: defaultUiLocale,
  setLocale: () => {},
  t: (key, values) => translate(defaultUiLocale, key, values),
};
