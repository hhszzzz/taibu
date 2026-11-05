/** A billing failure the routes turn into an HTTP status and an error code. */
export class BillingError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
        this.name = new.target.name;
    }
}
