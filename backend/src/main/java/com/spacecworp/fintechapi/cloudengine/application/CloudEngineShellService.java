package com.spacecworp.fintechapi.cloudengine.application;

import com.spacecworp.fintechapi.cloudengine.domain.model.AgentModule;
import com.spacecworp.fintechapi.cloudengine.domain.model.BudgetModule;
import com.spacecworp.fintechapi.cloudengine.domain.model.CloudEngineModule;
import com.spacecworp.fintechapi.cloudengine.domain.model.ExpenseModule;
import com.spacecworp.fintechapi.cloudengine.domain.model.PaymentModule;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CloudEngineShellService {
    public List<CloudEngineModule> modules() {
        return List.of(
                new BudgetModule(),
                new ExpenseModule(),
                new PaymentModule(),
                new AgentModule()
        );
    }

    public ShellResponse describeShell() {
        return describeShell("Cloud Engine");
    }

    public ShellResponse describeShell(String productName) {
        List<ShellModuleResponse> modules = modules().stream()
                .map(module -> new ShellModuleResponse(module.code(), module.title(), module.description(), module.visualTone(), module.badge()))
                .toList();
        return new ShellResponse(
                productName,
                "Unreal-inspired dark glass",
                "Spring Boot backend + ERP motor + Swing desktop shell",
                modules
        );
    }

    public record ShellResponse(
            String productName,
            String desktopTheme,
            String architecture,
            List<ShellModuleResponse> modules
    ) {}

    public record ShellModuleResponse(
            String code,
            String title,
            String description,
            String visualTone,
            String badge
    ) {}
}
