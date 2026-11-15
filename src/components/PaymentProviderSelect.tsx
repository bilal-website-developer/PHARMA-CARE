import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Banknote, Building2, ChevronDown, CreditCard, Wallet } from 'lucide-react';
import {
  PAYMENT_PROVIDER_GROUPS,
  getPaymentProvider,
  type PaymentProvider,
  type PaymentProviderId,
} from '../data/paymentProviders';

interface PaymentProviderSelectProps {
  value: PaymentProviderId;
  onChange: (providerId: PaymentProviderId) => void;
  includeCash?: boolean;
  includeCard?: boolean;
  ariaLabel: string;
}

interface PopupPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const PROVIDER_DROPDOWN_OPEN_EVENT = 'pharma-care:payment-provider-open';
const VIEWPORT_MARGIN = 12;
const POPUP_GAP = 4;

const ProviderLogo: React.FC<{ provider: PaymentProvider }> = ({ provider }) => {
  const [failed, setFailed] = useState(false);
  if (provider.logoPath && !failed) {
    return (
      <img
        src={provider.logoPath}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className="h-5 w-5 shrink-0 object-contain"
      />
    );
  }

  const Icon = provider.category === 'cash'
    ? Banknote
    : provider.category === 'bank'
      ? Building2
      : provider.category === 'card'
        ? CreditCard
        : Wallet;
  return <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />;
};

export const PaymentProviderSelect: React.FC<PaymentProviderSelectProps> = ({
  value,
  onChange,
  includeCash = false,
  includeCard = false,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const instanceId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);
  const groups = useMemo(() => PAYMENT_PROVIDER_GROUPS.map((group) => ({
    ...group,
    providers: group.providers,
  })), []);
  const options = useMemo(() => [
    ...(includeCash ? [getPaymentProvider('cash')!] : []),
    ...groups.flatMap((group) => group.providers),
    ...(includeCard ? [getPaymentProvider('card')!] : []),
  ], [groups, includeCash, includeCard]);
  const selectedProvider = getPaymentProvider(value) ?? options[0];

  useLayoutEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const trigger = buttonRef.current;
      const listbox = listboxRef.current;
      if (!trigger || !listbox) return;

      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const availableBelow = Math.max(
        0,
        viewportHeight - rect.bottom - POPUP_GAP - VIEWPORT_MARGIN,
      );
      const availableAbove = Math.max(0, rect.top - POPUP_GAP - VIEWPORT_MARGIN);
      const contentHeight = listbox.scrollHeight;
      const openUpward = contentHeight > availableBelow && availableAbove > availableBelow;
      const maxHeight = openUpward ? availableAbove : availableBelow;
      const height = Math.min(contentHeight, maxHeight);
      const width = Math.min(
        Math.max(rect.width, listbox.scrollWidth),
        Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2),
      );
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left, viewportWidth - VIEWPORT_MARGIN - width),
      );
      const top = openUpward
        ? rect.top - POPUP_GAP - height
        : rect.bottom + POPUP_GAP;

      setPopupPosition({ left, top, width, maxHeight });
    };

    positionPopup();
    window.addEventListener('resize', positionPopup);
    return () => window.removeEventListener('resize', positionPopup);
  }, [open, options.length]);

  useEffect(() => {
    const closeWhenAnotherOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== instanceId) {
        setOpen(false);
      }
    };
    window.addEventListener(PROVIDER_DROPDOWN_OPEN_EVENT, closeWhenAnotherOpens);
    return () => window.removeEventListener(PROVIDER_DROPDOWN_OPEN_EVENT, closeWhenAnotherOpens);
  }, [instanceId]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnScroll = (event: Event) => {
      if (!listboxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const openDropdown = () => {
    window.dispatchEvent(new CustomEvent(PROVIDER_DROPDOWN_OPEN_EVENT, { detail: instanceId }));
    setOpen(true);
  };

  const selectProvider = (provider: PaymentProvider) => {
    onChange(provider.id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) {
        const selectedIndex = options.findIndex((provider) => provider.id === value);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        openDropdown();
      } else {
        setActiveIndex((index) => (index + direction + options.length) % options.length);
      }
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        const selectedIndex = options.findIndex((provider) => provider.id === value);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        openDropdown();
        return;
      }
      const provider = options[activeIndex];
      if (provider) selectProvider(provider);
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-controls={`${instanceId}-payment-provider-listbox`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={open ? `${instanceId}-payment-provider-option-${options[activeIndex]?.id}` : undefined}
        onClick={() => {
          if (!open) {
            const selectedIndex = options.findIndex((provider) => provider.id === value);
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
            openDropdown();
          } else {
            setOpen(false);
          }
        }}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-control border border-border bg-surface px-2 py-1.5 text-left text-xs font-semibold text-text hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {selectedProvider && <ProviderLogo provider={selectedProvider} />}
        <span className="min-w-0 flex-1 truncate">{selectedProvider?.name ?? 'Choose provider'}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>
      {open && createPortal(
        <div
          ref={listboxRef}
          id={`${instanceId}-payment-provider-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className="fixed z-[1000] w-max max-w-[min(22rem,calc(100vw-1.5rem))] rounded-control border border-border bg-surface p-1 shadow-xl"
          style={{
            left: popupPosition?.left ?? 0,
            top: popupPosition?.top ?? 0,
            width: popupPosition ? `${popupPosition.width}px` : undefined,
            maxHeight: popupPosition ? `${popupPosition.maxHeight}px` : undefined,
            overflowY: popupPosition && listboxRef.current
              && listboxRef.current.scrollHeight > popupPosition.maxHeight
              ? 'auto'
              : 'visible',
            visibility: popupPosition ? 'visible' : 'hidden',
          }}
        >
          {includeCash && options[0] && (
            <ProviderOption
              provider={options[0]}
              id={`${instanceId}-payment-provider-option-${options[0].id}`}
              active={activeIndex === 0}
              selected={value === options[0].id}
              onMouseEnter={() => setActiveIndex(0)}
              onSelect={() => selectProvider(options[0])}
            />
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                {group.label}
              </p>
              {group.providers.map((provider) => {
                const index = options.findIndex((option) => option.id === provider.id);
                return (
                  <ProviderOption
                    key={provider.id}
                    id={`${instanceId}-payment-provider-option-${provider.id}`}
                    provider={provider}
                    active={activeIndex === index}
                    selected={value === provider.id}
                    onMouseEnter={() => setActiveIndex(index)}
                    onSelect={() => selectProvider(provider)}
                  />
                );
              })}
            </div>
          ))}
          {includeCard && options[options.length - 1] && (
            <ProviderOption
              provider={options[options.length - 1]}
              id={`${instanceId}-payment-provider-option-${options[options.length - 1].id}`}
              active={activeIndex === options.length - 1}
              selected={value === options[options.length - 1].id}
              onMouseEnter={() => setActiveIndex(options.length - 1)}
              onSelect={() => selectProvider(options[options.length - 1])}
            />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

const ProviderOption: React.FC<{
  id: string;
  provider: PaymentProvider;
  active: boolean;
  selected: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}> = ({ id, provider, active, selected, onMouseEnter, onSelect }) => (
  <div
    id={id}
    role="option"
    aria-selected={selected}
    onMouseEnter={onMouseEnter}
    onClick={onSelect}
    className={`flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-xs ${
      active ? 'bg-primary/10 text-text' : 'text-text hover:bg-surface-muted'
    }`}
  >
    <ProviderLogo provider={provider} />
    <span className="min-w-0 flex-1">{provider.name}</span>
    {selected && <span className="text-[10px] font-semibold text-primary">Selected</span>}
  </div>
);
