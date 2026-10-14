# Notification Design System

Правила дизайна и реализации уведомлений в ThinkRail.

## Принципы

1. **Переиспользуй компоненты** — не создавай нотификации в новом стиле, используй существующие паттерны
2. **Единообразие** — все нотификации следуют одному визуальному языку
3. **Семантика** — цвет рамки и иконки отражает тип сообщения

## Типы уведомлений

### Toast-нотификации

Всплывающие уведомления в правом нижнем углу.

**Компоненты:** `packages/ui/toast.tsx`, `apps/web/src/panels/Toaster.tsx`

**API (из `@/store`):**

```tsx
import { toast } from "@/store";

// Простые уведомления: (message, title?)
toast.info("Workspace synced");
toast.success("File saved", "Success");
toast.warning("Connection unstable");
toast.error("Failed to save", "Error");

// С действием или кастомной длительностью: pushToast
import { useAppStore } from "@/store";

useAppStore.getState().pushToast({
  variant: "info",
  message: "New version available",
  title: "Update",
  durationMs: 10000,
  action: { label: "Update now", onClick: () => update() },
});
```

**Варианты:**
- `info` — синяя рамка и иконка (`feedback-info`)
- `success` — зелёная (`feedback-success`)
- `warning` — жёлтая (`feedback-warning`)
- `error` — красная (`feedback-error`)

### Inline-уведомления

Встроенные в интерфейс уведомления. Используются в Welcome Panel, диалогах и панелях.

**Примеры:**
- `ProjectTrustNotice` — доверие проекту
- `ProviderWarningBanner` — отсутствие провайдера
- `ErrorTurn` — ошибка в чате

## Структура

### Однострочный layout (кнопка справа)

Используй когда:
- Текст помещается в одну строку
- Нет subtitle/description

```
┌──────────────────────────────────────────────────────┐
│ [icon]  Single line text message         [Button]   │
└──────────────────────────────────────────────────────┘
```

```tsx
<div className="flex items-center gap-8 rounded-sm border border-feedback-*-muted bg-container-elevated-bg px-12 py-8">
  <Icon className="-mt-2 size-14 shrink-0 text-feedback-*" />
  <span className="min-w-0 flex-1 tr-text-ui text-text-default">
    {message}
  </span>
  <Button variant="outline" size="sm">Action</Button>
</div>
```

### Многострочный layout (кнопки снизу)

Используй когда:
- Текст не помещается в одну строку
- Есть subtitle/description
- При адаптиве текст переносится

```
┌──────────────────────────────────────────────────────┐
│ [icon]  Multi-line text message that wraps          │
│         to multiple lines                           │
│         Subtitle/description text                   │
├──────────────────────────────────────────────────────┤
│                              [Button 1]  [Button 2] │
└──────────────────────────────────────────────────────┘
```

```tsx
<div className="flex flex-col gap-8 rounded-sm border border-feedback-*-muted bg-container-elevated-bg px-12 py-8">
  {/* Content row */}
  <div className="flex items-start gap-8">
    <Icon className="mt-1 size-14 shrink-0 text-feedback-*" />
    <span className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="tr-text-ui text-text-default">{title}</span>
      <span className="tr-text-metadata text-text-muted">{subtitle}</span>
    </span>
  </div>
  {/* Footer: buttons */}
  <div className="flex justify-end gap-8">
    <Button variant="ghost" size="sm">Secondary</Button>
    <Button variant="outline" size="sm">Primary</Button>
  </div>
</div>
```

## Стили

### Фон и рамка

- **Фон:** `bg-container-elevated-bg` (нейтральный, одинаковый для всех вариантов)
- **Рамка:** `border-feedback-*-muted` (семантический цвет с 40% прозрачностью)
- **Скругление:** `rounded-sm`
- **Паддинги:** `px-12 py-8`

### Иконки

- **Размер:** `size-14` (14px)
- **Цвет:** `text-feedback-*` (семантический)
- **Выравнивание однострочный:** `items-center` + `-mt-2` для оптической коррекции
- **Выравнивание многострочный:** `items-start` + `mt-1` для выравнивания с первой строкой

### Кнопки

- **Размер:** `size="sm"`
- **Одна кнопка:** `variant="outline"` (с бордером)
- **Две кнопки:**
  - Основное действие: `variant="outline"` (с бордером)
  - Дополнительное действие: `variant="ghost"` (без бордера)
- **Никогда** не используй `variant="primary"` или цветные кнопки

### Типографика

- **Основной текст:** `tr-text-ui text-text-default`
- **Subtitle:** `tr-text-metadata text-text-muted`

## Toast-специфика

### Структура

```tsx
<Toast>
  {/* Content row: icon + text + close */}
  <div className="flex items-start gap-8">
    <Icon className="mt-1 size-14 shrink-0 text-feedback-*" />
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <ToastTitle>{title}</ToastTitle>
      <ToastDescription>{message}</ToastDescription>
    </div>
    <ToastClose />
  </div>
  {/* Footer: action button */}
  {action && (
    <div className="mt-12 flex justify-end">
      <Button variant="outline" size="sm">{action.label}</Button>
    </div>
  )}
</Toast>
```

### Кнопка закрытия

- В потоке с `ml-auto`, не `position: absolute`
- Находится в content row, рядом с текстом
- Не влияет на позицию action button в футере

### Отступы

- Между контентом и футером: `mt-12` (12px)
- Gap между элементами: `gap-8` (8px)

## Чеклист при создании нотификации

- [ ] Используется существующий компонент/паттерн
- [ ] Фон `bg-container-elevated-bg`
- [ ] Рамка `border-feedback-*-muted`
- [ ] Иконка с правильным цветом `text-feedback-*`
- [ ] Кнопки: одна — `outline`, две — secondary `ghost` + primary `outline`
- [ ] Правильный layout: однострочный или многострочный
- [ ] Иконка выровнена с текстом

## Запрещено

- ❌ Создавать нотификации в совершенно новом стиле
- ❌ Использовать `variant="primary"` или цветные кнопки
- ❌ Использовать `variant="outline"` для secondary action при двух кнопках
- ❌ Использовать `position: absolute` для кнопки закрытия в toast
- ❌ Располагать кнопки справа при многострочном тексте
- ❌ Использовать тонированный фон (`bg-feedback-*-subtle`)
