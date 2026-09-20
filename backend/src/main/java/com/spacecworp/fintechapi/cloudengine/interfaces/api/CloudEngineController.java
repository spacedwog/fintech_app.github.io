package com.spacecworp.fintechapi.cloudengine.interfaces.api;

import com.spacecworp.fintechapi.cloudengine.application.CloudEngineErpService;
import com.spacecworp.fintechapi.cloudengine.application.CloudEngineShellService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/cloud-engine")
public class CloudEngineController {
    private final CloudEngineShellService shellService;
    private final CloudEngineErpService erpService;

    public CloudEngineController(CloudEngineShellService shellService, CloudEngineErpService erpService) {
        this.shellService = shellService;
        this.erpService = erpService;
    }

    @GetMapping("/shell")
    public CloudEngineShellService.ShellResponse shell() {
        return shellService.describeShell();
    }

    @GetMapping("/erp-overview")
    public CloudEngineErpService.ErpOverview erpOverview() {
        return erpService.loadOverview();
    }
}
