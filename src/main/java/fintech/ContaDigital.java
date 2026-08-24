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
        System.out.println("Executando método depositar");
    }

    public void sacar() {
        System.out.println("Executando método sacar");
    }

    public void consultarSaldo() {
        System.out.println("Executando método consultarSaldo");
    }
}
