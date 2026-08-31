package com.spacecworp.fintechapi.payments;

import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class ReceiptAnalysisAiAgent {
    private static final String MERCHANT_CNPJ_DIGITS = "62904267000160";
    private static final String MERCHANT_NAME = "SPACECWORP";
    private static final Set<String> KNOWN_TYPES = Set.of("plano_free", "plano_premium", "despesa", "outros");
    private static final Pattern AMOUNT_PATTERN = Pattern.compile("\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2}");
    private static final Pattern TXN_PATTERN = Pattern.compile("(?i)(?:transa(?:c|ç)ao|autentica(?:c|ç)ao|id|nsu|codigo)[^0-9a-zA-Z]{0,20}([0-9a-zA-Z-]{6,})");
    private static final Pattern LONG_DIGITS_PATTERN = Pattern.compile("\\b\\d{8,}\\b");

    public ReceiptTextAnalysisResult analyzeText(String rawText, Double expectedAmount, String expectedType) {
        String text = rawText == null ? "" : rawText;
        String digits = text.replaceAll("\\D+", "");
        String letters = onlyLetters(text);

        boolean merchantMatches = digits.contains(MERCHANT_CNPJ_DIGITS) || letters.contains(MERCHANT_NAME);
        List<Double> amounts = parseAmounts(text);

        boolean amountMatches = false;
        Double detectedAmount = amounts.isEmpty() ? null : amounts.get(0);
        if (expectedAmount != null) {
            for (Double amount : amounts) {
                if (closeEnough(amount, expectedAmount, 0.05d)) {
                    amountMatches = true;
                    detectedAmount = amount;
                    break;
                }
            }
        }

        String normalizedExpectedType = normalizeType(expectedType);
        String classification = "outros";
        if (amountMatches && normalizedExpectedType != null) {
            classification = normalizedExpectedType;
        } else if (detectedAmount != null) {
            if (closeEnough(detectedAmount, 19.99d, 0.05d)) classification = "plano_premium";
            else if (closeEnough(detectedAmount, 5.0d, 0.05d)) classification = "despesa";
        }
        if ("outros".equals(classification)) {
            if (letters.contains("PREMIUM")) classification = "plano_premium";
            else if (letters.contains("GRATIS") || letters.contains("FREE")) classification = "plano_free";
            else if (letters.contains("DESPESA")) classification = "despesa";
        }

        double confidence = 0d;
        if (merchantMatches) confidence += 0.5d;
        if (amountMatches) confidence += 0.4d;
        if (!"outros".equals(classification)) confidence += 0.1d;
        confidence = Math.max(0d, Math.min(1d, confidence));

        return new ReceiptTextAnalysisResult(
                true,
                merchantMatches,
                amountMatches,
                detectedAmount,
                classification,
                confidence,
                extractTransactionNumber(text)
        );
    }

    private List<Double> parseAmounts(String text) {
        List<Double> values = new ArrayList<>();
        Matcher matcher = AMOUNT_PATTERN.matcher(text == null ? "" : text);
        while (matcher.find()) {
            String normalized = matcher.group().replace(".", "").replace(",", ".");
            try {
                values.add(Double.parseDouble(normalized));
            } catch (NumberFormatException ignored) {
            }
        }
        return values;
    }

    private String extractTransactionNumber(String text) {
        String raw = text == null ? "" : text;
        Matcher taggedMatcher = TXN_PATTERN.matcher(stripAccents(raw).toLowerCase(Locale.ROOT));
        if (taggedMatcher.find()) return taggedMatcher.group(1).trim();
        Matcher longDigits = LONG_DIGITS_PATTERN.matcher(raw);
        if (longDigits.find()) return longDigits.group().trim();
        return null;
    }

    private boolean closeEnough(double a, double b, double tolerance) {
        return Math.abs(a - b) <= tolerance;
    }

    private String normalizeType(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        return KNOWN_TYPES.contains(normalized) ? normalized : null;
    }

    private String stripAccents(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
    }

    private String onlyLetters(String value) {
        return stripAccents(value).toUpperCase(Locale.ROOT).replaceAll("[^A-Z]", "");
    }

    public record ReceiptTextAnalysisResult(
            boolean ok,
            boolean merchantMatches,
            boolean amountMatches,
            Double detectedAmount,
            String classification,
            double confidence,
            String transactionNumber
    ) {
    }
}
