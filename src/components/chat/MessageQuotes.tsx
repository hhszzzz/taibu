import { Quote } from 'lucide-react';

/** Quote cards shown above a user bubble, in the chat transcript and on shared pages. */
export function MessageQuoteCards({ quotes }: { quotes: ReadonlyArray<{ text: string }> }) {
    if (!quotes.length) return null;
    return <div className="chat-message-quotes" aria-label="引用的回答">
        {quotes.map((quote, index) => <blockquote key={index} className="chat-message-quote" title={quote.text}>
            <Quote size={12} aria-hidden="true" />
            <p>{quote.text}</p>
        </blockquote>)}
    </div>;
}
