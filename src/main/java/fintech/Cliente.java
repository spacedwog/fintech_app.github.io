package fintech;

public class Cliente {

    private Integer idCliente;
    private String nomeCompleto;
    private String email;
    private String cpf;
    private String telefone;

    public Cliente() {
    }

    public Cliente(Integer idCliente, String nomeCompleto, String email, String cpf, String telefone) {
        this.idCliente = idCliente;
        this.nomeCompleto = nomeCompleto;
        this.email = email;
        this.cpf = cpf;
        this.telefone = telefone;
    }

    public void cadastrarCliente() {
        System.out.println("Executando método cadastrarCliente");
    }

    public void atualizarCadastro() {
        System.out.println("Executando método atualizarCadastro");
    }

    public void consultarPerfil() {
        System.out.println("Executando método consultarPerfil");
    }
}
