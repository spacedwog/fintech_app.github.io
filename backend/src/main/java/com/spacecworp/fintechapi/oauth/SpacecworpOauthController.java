package com.spacecworp.fintechapi.oauth;

import com.spacecworp.fintechapi.auth.AuthDtos;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.util.List;

@RestController
@RequestMapping("/api/v1/spacecworp-oauth")
public class SpacecworpOauthController {
    private final SpacecworpOauthService service;

    public SpacecworpOauthController(SpacecworpOauthService service) {
        this.service = service;
    }

    @GetMapping("/.well-known/openid-configuration")
    public SpacecworpOauthDtos.DiscoveryResponse discovery() {
        return service.discovery(buildIssuer());
    }

    @PostMapping("/authorize")
    public SpacecworpOauthDtos.AuthorizeResponse authorize(@Valid @RequestBody SpacecworpOauthDtos.AuthorizeRequest request) {
        return service.authorize(request, buildIssuer());
    }

    @PostMapping("/token")
    public SpacecworpOauthDtos.TokenResponse token(@Valid @RequestBody SpacecworpOauthDtos.TokenRequest request) {
        return service.token(request, buildIssuer());
    }

    @PostMapping("/introspect")
    public SpacecworpOauthDtos.IntrospectResponse introspect(@Valid @RequestBody SpacecworpOauthDtos.IntrospectRequest request) {
        return service.introspect(request);
    }

    @PostMapping("/revoke")
    public AuthDtos.GenericResponse revoke(@Valid @RequestBody SpacecworpOauthDtos.RevokeRequest request) {
        service.revoke(request);
        return new AuthDtos.GenericResponse(true);
    }

    @GetMapping("/userinfo")
    public SpacecworpOauthDtos.UserInfoResponse userinfo() {
        AuthUser user = SecurityUtils.currentUser();
        return service.userinfo(user, buildIssuer());
    }

    @PostMapping("/clients")
    public SpacecworpOauthDtos.ClientRegistrationResponse createClient(@Valid @RequestBody SpacecworpOauthDtos.CreateClientRequest request) {
        AuthUser user = SecurityUtils.currentUser();
        return service.registerClient(user, request);
    }

    @GetMapping("/clients")
    public List<SpacecworpOauthDtos.ClientView> listClients() {
        AuthUser user = SecurityUtils.currentUser();
        return service.listClients(user);
    }

    private String buildIssuer() {
        return ServletUriComponentsBuilder.fromCurrentContextPath()
                .path("/api/v1/spacecworp-oauth")
                .toUriString();
    }
}
