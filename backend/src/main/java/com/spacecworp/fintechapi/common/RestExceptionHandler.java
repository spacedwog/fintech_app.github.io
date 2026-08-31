package com.spacecworp.fintechapi.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

import java.time.Instant;
import java.util.stream.Collectors;

@RestControllerAdvice
public class RestExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(RestExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApiException(ApiException ex, ServletWebRequest request) {
        return build(ex.getStatus(), ex.getMessage(), request.getRequest().getRequestURI());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex, ServletWebRequest request) {
        String message = ex.getBindingResult().getAllErrors().stream()
                .map(err -> err instanceof FieldError f ? f.getField() + ": " + f.getDefaultMessage() : err.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return build(HttpStatus.BAD_REQUEST, message, request.getRequest().getRequestURI());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleDenied(AccessDeniedException ex, ServletWebRequest request) {
        return build(HttpStatus.FORBIDDEN, "Acesso negado", request.getRequest().getRequestURI());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex, ServletWebRequest request) {
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "Erro interno", request.getRequest().getRequestURI());
    }

    private ResponseEntity<ApiError> build(HttpStatus status, String message, String path) {
        log.warn(
                "event=api_error request_id={} status={} path={} message={}",
                MDC.get("request_id"),
                status.value(),
                path,
                message
        );
        return ResponseEntity.status(status).body(new ApiError(Instant.now(), status.value(), status.getReasonPhrase(), message, path));
    }
}
