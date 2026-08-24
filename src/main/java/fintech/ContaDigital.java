package fintech;

public class ContaDigital {

    private String numeroConta;
    private String agencia;
    private String tipoConta;
    private Double saldo;
    private Integer idCliente;

    public ContaDigital() {
    }

    public ContaDigital(String numeroConta, String agencia, String tipoConta, Double saldo, Integer idCliente) {
        this.numeroConta = numeroConta;
        this.agencia = agencia;
        this.tipoConta = tipoConta;
        this.saldo = saldo;
        this.idCliente = idCliente;
    }

    public void depositar() {
        System.out.println("Objetivo: depositar valor na conta digital.");
    }

    public void sacar() {
        System.out.println("Objetivo: sacar valor disponível da conta digital.");
    }

    public void consultarSaldo() {
        System.out.println("Objetivo: consultar o saldo atual da conta digital.");
    }
}
