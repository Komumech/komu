import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
}

interface PageIntelligenceProps {
  url: string;
  title: string;
  snippet: string;
  apiKey: string;
  allResults?: any[];
}

// Generate dynamic questions and answers combining metadata, chunks, and how-tos cleanly
function buildUnifiedPeopleAlsoAsk(url: string, title: string, snippet: string, allResults: any[]): FAQItem[] {
  const cleanTitle = title.replace(/[:|\\-]/g, '').trim();
  const words = cleanTitle.split(' ').filter(w => w.length > 3);
  const mainTopic = words[0] || 'Resource';

  // Check if we have valid database entries from Pinecone
  const cleanUrl = url.replace(/^https?:\/\//i, '').replace(/\/$/i, '').toLowerCase();
  
  const databaseMatches = (allResults || []).filter((r: any) => {
    if (!r.url) return false;
    const cleanRUrl = r.url.replace(/^https?:\/\//i, '').replace(/\/$/i, '').toLowerCase();
    
    if (cleanRUrl === cleanUrl) return true;
    
    try {
      const u1 = new URL(r.url).hostname.replace('www.', '');
      const u2 = new URL(url).hostname.replace('www.', '');
      return u1 === u2 && r.score && r.score > 0.45;
    } catch (_) {}
    return false;
  });

  const isRealDb = databaseMatches.length > 1;
  const faqsList: FAQItem[] = [];

  if (isRealDb) {
    // 1. Try to extract existing FAQ entities from Pinecone database
    databaseMatches.forEach((item: any) => {
      const text = item.snippet || item.text || '';
      const isFaq = item.is_faq === "true" || item.is_faq === true || item.id?.includes('faq') || item.id?.includes('faq_');
      const hasQA = text.toLowerCase().includes('question:') && text.toLowerCase().includes('answer:');

      if (isFaq || hasQA) {
        const qMatch = text.match(/Question:\s*(.*?)\s*Answer:\s*(.*)/i);
        const qNumMatch = text.match(/Q:\s*(.*?)\s*A:\s*(.*)/i);
        if (qMatch) {
          faqsList.push({
            question: qMatch[1].trim(),
            answer: qMatch[2].trim()
          });
        } else if (qNumMatch) {
          faqsList.push({
            question: qNumMatch[1].trim(),
            answer: qNumMatch[2].trim()
          });
        } else {
          const qIndex = text.indexOf('?');
          if (qIndex !== -1) {
            faqsList.push({
              question: text.substring(0, qIndex + 1).trim(),
              answer: text.substring(qIndex + 1).trim()
            });
          }
        }
      }
    });

    // 2. Extract How-To processes from database to build the "How do I..." FAQ row
    const steps: string[] = [];
    databaseMatches.forEach((item: any) => {
      const text = item.snippet || item.text || '';
      // Look for steps
      const stepRegex = /(?:Step|Step\s)?\s*(\d+)[\s.:-]\s*([^.]+)/gi;
      let stepMatch;
      while ((stepMatch = stepRegex.exec(text)) !== null && steps.length < 4) {
        steps.push(`${stepMatch[1]}. ${stepMatch[2].trim()}`);
      }

      if (steps.length === 0) {
        // Try line splits for numbered offsets
        const numberedLines = text.split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => /^\d+[\s.)-]/.test(l));
        if (numberedLines.length > 1) {
          numberedLines.forEach((line: string) => {
            if (steps.length < 4) steps.push(line);
          });
        }
      }
    });

    if (steps.length > 0) {
      faqsList.push({
        question: `How do I set up or implement ${mainTopic}?`,
        answer: `Follow these verified database guidelines:\n\n${steps.join('\n')}`
      });
    }

    // 3. Fallback semantic overview query
    const importantFacts: string[] = [];
    databaseMatches.forEach((item: any) => {
      const text = item.snippet || item.text || '';
      if (text.length > 50 && !text.toLowerCase().includes('question:') && importantFacts.length < 3) {
        importantFacts.push(text.trim());
      }
    });

    if (importantFacts.length > 0) {
      faqsList.push({
        question: `What are the key technical details of ${cleanTitle}?`,
        answer: importantFacts[0]
      });
    }
  }

  // Ensure robust backup or complete default coverage matching exactly the subject
  if (faqsList.length < 3) {
    const defaultFaqs = [
      {
        question: `What is the primary concept behind ${cleanTitle}?`,
        answer: `This page focuses on "${cleanTitle}". It provides a structured overview, primarily addressing: "${snippet}"`
      },
      {
        question: `How do you get started with ${mainTopic}?`,
        answer: `1. Study the core specifications and guidelines presented on this resource.\n2. Identify the methodologies and configurations required to execute.\n3. Implement the guidelines in isolation to avoid integration loops.\n4. Verify design layouts to maintain responsive, clean user patterns.`
      },
      {
        question: `Why is this resource significant for the current topic?`,
        answer: `It establishes a reference model to reduce configuration errors. Instead of using generic frameworks, it introduces concrete standards that help developers and teams deploy high-fidelity systems.`
      }
    ];

    // Merge default entries if we don't have enough FAQs
    defaultFaqs.forEach((df) => {
      if (!faqsList.some((existing) => existing.question.toLowerCase().substring(0, 15) === df.question.toLowerCase().substring(0, 15))) {
        faqsList.push(df);
      }
    });
  }

  return faqsList.slice(0, 3); // Keep strictly up to 3 FAQs max for premium clean display
}

export function PageIntelligencePanel({ url, title, snippet, allResults }: PageIntelligenceProps) {
  const [faqs, setFaqs] = useState<FAQItem[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    const intel = buildUnifiedPeopleAlsoAsk(url, title, snippet, allResults || []);
    setFaqs(intel);
    setExpandedIndex(null); // Reset expand on page switch
  }, [url, allResults]);

  if (faqs.length === 0) return null;

  return (
    <div className="py-6 border-y border-slate-100 animate-in fade-in duration-500 w-full">
      <h4 className="font-display font-bold text-slate-800 text-xl mb-4">People also ask</h4>
      
      <div className="divide-y divide-slate-100">
        {faqs.map((faq, index) => {
          const isExpanded = expandedIndex === index;
          return (
            <div 
              key={index} 
              className="py-4"
            >
              {/* Row title bar clickable - exactly matching FAQBlock style */}
              <button
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
                className="w-full flex items-center justify-between text-left group cursor-pointer"
              >
                <span className="text-base md:text-lg font-normal text-slate-800 transition-colors">
                  {faq.question}
                </span>
                
                <ChevronRight 
                  size={18} 
                  className={`text-slate-400 transition-transform duration-300 shrink-0 ${isExpanded ? 'rotate-90' : ''}`} 
                />
              </button>

              {/* Seamless expanded text container */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3 pb-2 text-[15px] text-slate-600 leading-relaxed mt-2 p-2">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
