package com.spacecworp.fintechapi.cloudengine.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spacecworp.fintechapi.cloudengine.application.CloudEngineShellService;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

public final class CloudEngineDesktopLauncher {
    private CloudEngineDesktopLauncher() {
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new CloudEngineDesktopFrame().setVisible(true));
    }

    static final class CloudEngineDesktopFrame extends JFrame {
        private final JTextArea statusArea = new JTextArea();
        private final JPanel modulePanel = new JPanel(new GridLayout(0, 1, 12, 12));
        private final DesktopShellClient client = new DesktopShellClient();

        CloudEngineDesktopFrame() {
            super("Cloud Engine");
            setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
            setSize(1080, 720);
            setLocationRelativeTo(null);
            setLayout(new BorderLayout(16, 16));
            getContentPane().setBackground(new Color(10, 15, 26));

            JLabel title = new JLabel("Cloud Engine");
            title.setForeground(new Color(151, 255, 255));
            title.setFont(title.getFont().deriveFont(Font.BOLD, 28f));

            JLabel subtitle = new JLabel("ERP Desktop Shell • Unreal-inspired dark interface");
            subtitle.setForeground(new Color(187, 197, 216));

            JPanel header = new JPanel(new BorderLayout());
            header.setOpaque(false);
            header.setBorder(new EmptyBorder(24, 24, 0, 24));
            header.add(title, BorderLayout.NORTH);
            header.add(subtitle, BorderLayout.SOUTH);

            modulePanel.setOpaque(false);
            JPanel moduleWrapper = new JPanel(new BorderLayout());
            moduleWrapper.setOpaque(false);
            moduleWrapper.setBorder(new EmptyBorder(0, 24, 24, 24));
            moduleWrapper.add(new JScrollPane(modulePanel), BorderLayout.CENTER);

            statusArea.setEditable(false);
            statusArea.setBackground(new Color(18, 26, 40));
            statusArea.setForeground(new Color(210, 218, 230));
            statusArea.setBorder(new EmptyBorder(16, 16, 16, 16));
            statusArea.setLineWrap(true);
            statusArea.setWrapStyleWord(true);

            add(header, BorderLayout.NORTH);
            add(moduleWrapper, BorderLayout.CENTER);
            add(statusArea, BorderLayout.SOUTH);

            loadShell();
        }

        void loadShell() {
            loadShell(defaultBaseUrl());
        }

        void loadShell(String baseUrl) {
            statusArea.setText("Conectando ao backend Java...");
            new SwingWorker<CloudEngineShellService.ShellResponse, Void>() {
                @Override
                protected CloudEngineShellService.ShellResponse doInBackground() throws Exception {
                    return client.fetchShell(baseUrl);
                }

                @Override
                protected void done() {
                    try {
                        renderShell(get(), baseUrl);
                    } catch (Exception ex) {
                        statusArea.setText("Falha ao conectar no backend Java: " + ex.getMessage() + "\nUse CLOUD_ENGINE_API_BASE para apontar para outro servidor.");
                    }
                }
            }.execute();
        }

        private void renderShell(CloudEngineShellService.ShellResponse shell, String baseUrl) {
            modulePanel.removeAll();
            for (CloudEngineShellService.ShellModuleResponse module : shell.modules()) {
                modulePanel.add(createCard(module));
            }
            statusArea.setText("""
                    Produto: %s
                    Arquitetura: %s
                    Tema desktop: %s
                    Backend: %s
                    Executável: target/cloud-engine-desktop-jar-with-dependencies.jar
                    """.formatted(shell.productName(), shell.architecture(), shell.desktopTheme(), baseUrl));
            modulePanel.revalidate();
            modulePanel.repaint();
        }

        private JComponent createCard(CloudEngineShellService.ShellModuleResponse module) {
            JPanel card = new JPanel(new BorderLayout(8, 8));
            card.setBorder(new EmptyBorder(16, 16, 16, 16));
            card.setBackground(new Color(20, 29, 46));

            JLabel title = new JLabel(module.title());
            title.setForeground(Color.WHITE);
            title.setFont(title.getFont().deriveFont(Font.BOLD, 18f));

            JLabel badge = new JLabel(module.badge());
            badge.setForeground(colorForTone(module.visualTone()));

            JTextArea description = new JTextArea(module.description());
            description.setEditable(false);
            description.setOpaque(false);
            description.setForeground(new Color(200, 210, 226));
            description.setLineWrap(true);
            description.setWrapStyleWord(true);

            card.add(title, BorderLayout.NORTH);
            card.add(description, BorderLayout.CENTER);
            card.add(badge, BorderLayout.SOUTH);
            return card;
        }

        private Color colorForTone(String visualTone) {
            return switch (String.valueOf(visualTone)) {
                case "amber" -> new Color(255, 196, 87);
                case "emerald" -> new Color(61, 227, 168);
                case "violet" -> new Color(186, 132, 255);
                default -> new Color(110, 231, 255);
            };
        }

        private String defaultBaseUrl() {
            String env = System.getenv("CLOUD_ENGINE_API_BASE");
            return env == null || env.isBlank() ? "http://localhost:8080" : env.trim();
        }
    }

    static final class DesktopShellClient {
        private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        private final ObjectMapper objectMapper = new ObjectMapper();

        CloudEngineShellService.ShellResponse fetchShell(String baseUrl) throws Exception {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/api/v1/cloud-engine/shell"))
                    .timeout(Duration.ofSeconds(10))
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 400) {
                throw new IllegalStateException("HTTP " + response.statusCode());
            }
            return objectMapper.readValue(response.body(), CloudEngineShellService.ShellResponse.class);
        }
    }
}
