import { Quote, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { MessageQuote } from '@/lib/chat/quotes';

/** 输入框上方的引用条：每段可单独移除，条数与字数上限由调用方保证。 */
export function QuoteBar({ quotes, onRemove, disabled = false }: {
    quotes: readonly MessageQuote[];
    onRemove?: (index: number) => void;
    disabled?: boolean;
}) {
    if (!quotes.length) return null;
    return <div className="chat-composer-quotes" aria-label="引用">
        <span className="chat-composer-quotes-label"><Quote size={12} aria-hidden="true" />已引用 {quotes.length} 段</span>
        <ul className="chat-composer-quotes-list">
            {quotes.map((quote, index) => <li key={`${quote.messageId}:${index}`} className="chat-composer-quote">
                <p title={quote.text}>{quote.text}</p>
                <Button unstyled type="button" aria-label={`移除第 ${index + 1} 段引用`} title="移除引用" disabled={disabled} onClick={() => onRemove?.(index)}>
                    <X size={12} aria-hidden="true" />
                </Button>
            </li>)}
        </ul>
    </div>;
}
