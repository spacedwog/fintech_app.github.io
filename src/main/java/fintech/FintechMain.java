package fintech;

import java.math.BigDecimal;

public class FintechMain {

    public static void main(String[] args) {
        System.out.println("Objetivo: demonstrar o fluxo mínimo com duas classes do sistema fintech.");
        Cliente cliente = new Cliente(1, "Ana Souza", "ana@fintech.com", "12345678901", "11999999999");

        ContaDigital conta = new ContaDigital(
                1001,
                "Conta Principal",
                cliente,
                "000123-4",
                "0001",
                "Corrente",
                new BigDecimal("1000.00")
        );

        cliente.adicionarProduto(conta);
        conta.depositar(new BigDecimal("250.00"));
        System.out.println("Saldo final da conta: " + conta.consultarSaldo());
    }
}
